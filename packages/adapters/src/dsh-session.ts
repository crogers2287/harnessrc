import type { DshQuestions } from './dsh-questions.ts';
import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import { z } from 'zod';
import {
  capabilities,
  permissionSettingsSchema,
  DeliveryDeferred,
  type Adapter,
  type Session,
  type SourceEvent,
  type Task,
  type Interaction,
} from '@harnessrc/protocol';
import { DshClient, type DshAttachment } from './dsh.ts';

export const dshRowSchema = z.object({
  sessionId: z.string(),
  updatedAt: z.number(),
  running: z.boolean(),
  agentAvailable: z.boolean(),
  cwd: z.string().optional(),
  projections: z
    .object({ asOfSeq: z.number(), values: z.record(z.string(), z.any()) })
    .passthrough()
    .optional(),
});
const nativeEvent = z.object({
  seq: z.number().int().nonnegative(),
  time: z.number(),
  type: z.string(),
  data: z.any(),
  surfaceOp: z.unknown().optional(),
  sourceEventSeqs: z.array(z.number()).optional(),
});
export type DshRow = z.infer<typeof dshRowSchema>;
export function dshStatus(row: DshRow): Session['status'] {
  const p = row.projections?.values ?? {};
  const pending = Array.isArray(p.userQuestions?.active) && p.userQuestions.active.length > 0;
  return pending ? 'blocked' : row.running ? 'working' : 'idle';
}
export function dshEvents(input: unknown): SourceEvent[] {
  const e = nativeEvent.parse(input),
    d = e.data;
  const base = {
    sourceId: `dsh:${e.seq}`,
    timestamp: new Date(e.time).toISOString(),
    turnId: d?.turn === undefined ? undefined : String(d.turn),
  };
  const text = (m: any) =>
    (m?.content ?? [])
      .filter((p: any) => p.type === 'text')
      .map((p: any) => p.text)
      .join('\n');
  const replaced =
    e.surfaceOp === 'replace' ? (e.sourceEventSeqs ?? []).map((n) => `dsh:${n}`) : [];
  if (e.type === 'deliverables/presented')
    return [
      {
        ...base,
        kind: 'artifact.created',
        data: { title: 'Files from your agent', nativeFiles: d.files },
      },
    ];
  if (e.type === 'user/message')
    return [
      {
        ...base,
        kind: 'user.message',
        data: { text: text(d), requestId: d.source?.rpcId, replacesEventSourceIds: replaced },
      },
    ];
  if (e.type === 'assistant/message')
    return [
      {
        ...base,
        kind: 'assistant.message',
        data: {
          text: text(d.message),
          model: d.message?.source?.model,
          itemId: `dsh-step:${d.turn}:${d.step}`,
          replacesEventSourceIds: replaced,
        },
      },
    ];
  if (e.type === 'turn/start') return [{ ...base, kind: 'turn.started', data: {} }];
  if (e.type === 'turn/end')
    return [
      {
        ...base,
        kind: d.reason?.kind === 'completed' ? 'turn.completed' : 'turn.failed',
        data: { reason: d.reason?.kind },
      },
    ];
  if (e.type === 'tool/call')
    return [
      {
        ...base,
        kind: 'tool.invocation',
        data: { tool: d.name ?? d.tool?.name ?? 'Tool', input: d.arguments ?? d.input },
      },
    ];
  if (e.type === 'tool/result')
    return [
      {
        ...base,
        kind: 'tool.output',
        data: {
          text:
            typeof d.content === 'string' ? d.content : JSON.stringify(d.content ?? d.result ?? {}),
        },
      },
    ];
  if (e.type === 'model/selection')
    return [{ ...base, kind: 'agent.status', data: { model: d.model } }];
  return [];
}

/** Existing web-host session. All writes go through that host's sole native agent owner. */
export class DshAdapter implements Adapter {
  capabilities = capabilities([
    'readConversation',
    'streamConversation',
    'sendMessage',
    'steerActiveTurn',
    'queueTask',
    'answerQuestion',
  ]);
  private last = -1;
  private records = new Map<number, z.infer<typeof nativeEvent>>();
  private socket?: WebSocket;
  private stopped = false;
  private retry?: NodeJS.Timeout;
  private reading?: Promise<SourceEvent[]>;
  private touched = 0;
  constructor(
    public native: DshClient,
    private endpoint: string,
    private credential: () => Promise<string>,
    private emit: (event: SourceEvent) => void,
    private questions?: DshQuestions,
    private attachment?: (session: Session, id: string) => DshAttachment,
    private decorate?: (session: Session, event: SourceEvent) => SourceEvent,
  ) {
    this.capabilities.attachFiles = !!attachment;
  }
  private async input(s: Session, t: Pick<Task, 'id' | 'prompt' | 'attachments'>) {
    // Resolve and verify ALL owners/checksums before performing any native uploads.
    const files = t.attachments.map((id) => {
      if (!this.attachment) throw new Error('DSH attachment storage is unavailable');
      return this.attachment(s, id);
    });
    return this.native.content(s.nativeSessionId, t.prompt, files);
  }
  private events(s: Session, input: unknown) {
    return dshEvents(input).map((event) => this.decorate?.(s, event) ?? event);
  }
  async row(s: Session) {
    const rows = z.object({ items: z.array(dshRowSchema) }).parse(await this.native.list()).items;
    const row = rows.find((r) => r.sessionId === s.nativeSessionId);
    if (!row) throw new Error('DSH native session no longer exists');
    return row;
  }
  async permissions(s: Session) {
    const row = await this.row(s);
    const current = row.projections?.values.permissions?.currentValue;
    if (typeof current !== 'string' || !row.agentAvailable)
      return {
        supported: false,
        options: [],
        reason: 'This DSH session does not expose live permission controls.',
      };
    const catalog = z
      .object({ options: permissionSettingsSchema.shape.options })
      .parse(await this.native.call('permissionPresets/catalog', {}));
    return { supported: true, current, options: catalog.options };
  }
  async setPermissions(s: Session, value: string, expected: string) {
    const settings = await this.permissions(s);
    if (!settings.supported || settings.current !== expected)
      throw Object.assign(
        new Error('Permissions changed. Reload the current settings before applying.'),
        { statusCode: 409 },
      );
    if (!/^[a-zA-Z0-9_-]+$/.test(value) || !settings.options.some((o) => o.value === value))
      throw Object.assign(new Error('Permission preset is not available.'), { statusCode: 400 });
    const result = z
      .object({ result: z.object({ kind: z.string() }) })
      .parse(
        await this.native.call('commands/execute', {
          agentId: s.nativeSessionId,
          line: `/permission ${value}`,
          submittedAttachments: [],
        }),
      );
    if (result.result.kind !== 'success')
      throw new Error('DSH did not apply the permission preset.');
    const updated = await this.permissions(s);
    if (updated.current !== value)
      throw new Error('DSH has not confirmed the permission change. Refresh before retrying.');
    return updated;
  }
  async turnState(s: Session) {
    return this.questions?.interactions(s.nativeSessionId).length
      ? 'blocked'
      : dshStatus(await this.row(s));
  }
  async interactions(s: Session) {
    return this.questions?.interactions(s.nativeSessionId) ?? [];
  }
  validateInteractionResponse(s: Session, interaction: Interaction, response: unknown) {
    if (!this.questions) throw new Error('DSH question channel unavailable');
    this.questions.validate(s.nativeSessionId, interaction.nativeRequestId, response);
  }
  async respond(s: Session, interaction: Interaction, response: unknown) {
    await this.row(s);
    if (!this.questions) throw new Error('DSH question channel unavailable');
    await this.questions.respond(s.nativeSessionId, interaction.nativeRequestId, response);
  }
  watch(_s: Session) {
    this.touched = Date.now();
  }
  async read(s: Session): Promise<SourceEvent[]> {
    if (this.reading) return this.reading;
    if (!this.touched) return [];
    this.reading = this.readHistory(s).finally(() => {
      this.reading = undefined;
    });
    return this.reading;
  }
  private async readHistory(s: Session) {
    const p = z.object({ asOfSeq: z.number() }).parse(
      await this.native.call('session/projections', {
        request: { sessionId: s.nativeSessionId },
      }),
    );
    if (p.asOfSeq <= this.last) return [];
    let before: number | undefined;
    const fresh: z.infer<typeof nativeEvent>[] = [];
    for (let pages = 0; pages < 200; pages++) {
      const page = z
        .object({
          records: z.array(z.object({ type: z.literal('event'), event: nativeEvent })),
          hasMore: z.boolean(),
        })
        .parse(
          await this.native.call('session/page', {
            request: {
              address: { kind: 'session', sessionId: s.nativeSessionId },
              throughSeq: p.asOfSeq,
              maxMessages: 100,
              ...(before === undefined ? {} : { beforeSeq: before }),
            },
          }),
        );
      const events = page.records.map((r) => r.event);
      fresh.push(...events.filter((e) => e.seq > this.last));
      const first = events[0]?.seq;
      if (!page.hasMore || first === undefined || first <= this.last) break;
      if (pages === 199 || (before !== undefined && first >= before))
        throw new Error('DSH history could not be fully loaded');
      before = first;
    }
    fresh.sort((a, b) => a.seq - b.seq);
    for (const e of fresh) this.records.set(e.seq, e);
    this.last = p.asOfSeq;
    setTimeout(() => void this.connect(s), 0);
    return fresh.flatMap((e) => this.events(s, e));
  }
  async send(s: Session, t: Task) {
    if (!['idle', 'done'].includes(await this.turnState(s)))
      throw new DeliveryDeferred('DSH agent is busy');
    this.watch(s);
    await this.native.prompt(s.nativeSessionId, t.id, await this.input(s, t), 'queue');
    return { correlation: t.id };
  }
  async steer(
    s: Session,
    prompt: string,
    _images?: string[],
    input?: Pick<Task, 'id' | 'prompt' | 'attachments'>,
  ) {
    if ((await this.turnState(s)) !== 'working') throw new Error('DSH active turn has ended');
    const task = input ?? { id: randomUUID(), prompt, attachments: [] };
    this.watch(s);
    await this.native.prompt(s.nativeSessionId, task.id, await this.input(s, task), 'steer');
  }
  async reconcile(s: Session, t: Task): Promise<'running' | 'completed' | 'failed' | 'uncertain'> {
    this.touched = Date.now();
    for (const e of await this.read(s)) this.emit(e);
    const events = [...this.records.values()].sort((a, b) => a.seq - b.seq);
    const user = events.find((e) => e.type === 'user/message' && e.data.source?.rpcId === t.id);
    if (!user)
      return events.some(
        (e) =>
          e.type === 'agent/inbox/spliced' &&
          e.data.inserted?.some((m: any) => m.source?.rpcId === t.id),
      )
        ? 'running'
        : 'uncertain';
    const end = events.find((e) => e.seq > user.seq && e.type === 'turn/end');
    return end ? (end.data.reason?.kind === 'completed' ? 'completed' : 'failed') : 'running';
  }
  private async connect(s: Session) {
    if (this.stopped || this.socket || Date.now() - this.touched > 600000) return;
    try {
      const cookie = await this.credential();
      if (this.socket || this.stopped) return;
      const url = new URL('/api/remote.mux', this.endpoint);
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(url, {
        headers: { Cookie: cookie, Origin: new URL(this.endpoint).origin },
        maxPayload: 16 * 1024 * 1024,
      });
      this.socket = ws;
      let active: { id: string; turn: number; step: number } | undefined;
      const chunk = (index: number, time: number, c: any) => {
        if (active && c.type === 'text-delta')
          this.emit({
            sourceId: `dsh-live:${active.id}:${index}`,
            kind: 'assistant.delta',
            timestamp: new Date(time).toISOString(),
            turnId: String(active.turn),
            data: { text: c.text, itemId: `dsh-step:${active.turn}:${active.step}` },
          });
      };
      ws.on('open', () =>
        ws.send(
          JSON.stringify({
            type: 'open',
            streamId: 'conversation',
            endpoint: 'session/follow',
            payload: {
              args: {
                request: {
                  address: { kind: 'session', sessionId: s.nativeSessionId },
                  maxMessages: 20,
                  assistantStream: true,
                },
              },
            },
          }),
        ),
      );
      ws.on('message', (bytes) => {
        try {
          const envelope = JSON.parse(bytes.toString());
          if (envelope.type === 'error') {
            ws.close();
            return;
          }
          if (envelope.type !== 'item') return;
          const v = envelope.value;
          if (v?.type === 'event') {
            for (const e of this.events(s, v.event)) this.emit(e);
            return;
          }
          if (v?.type === 'snapshot') {
            for (const r of v.records ?? []) for (const e of this.events(s, r.event)) this.emit(e);
            const a = v.assistantStream?.activeAttempt;
            if (a) {
              active = { id: a.attemptId, turn: a.turn, step: a.step };
              let i = 0;
              for (const r of a.stream) {
                if (r.type === 'chunk') chunk(i++, r.time, r.chunk);
                else if (r.type === 'text-chunks') {
                  let time = r.time0;
                  for (let j = 0; j < r.texts.length; j++) {
                    if (j) time += r.dt[j - 1];
                    chunk(i++, time, { type: 'text-delta', text: r.texts[j] });
                  }
                } else if (r.type === 'reasoning-chunks') i += r.texts.length;
                else if (r.type === 'tool-call-chunks') i += r.args.length;
                else throw new Error('Unknown DSH stream record');
              }
            }
          }
          if (v?.type === 'assistant-stream') {
            const f = v.frame;
            if (f.type === 'start') active = { id: f.attemptId, turn: f.turn, step: f.step };
            else if (f.type === 'chunk') chunk(f.index, f.time, f.chunk);
            else if (f.type === 'end') active = undefined;
          }
        } catch {
          ws.close();
        }
      });
      ws.on('error', () => ws.close());
      ws.on('close', () => {
        if (this.socket === ws) this.socket = undefined;
        if (!this.stopped) this.retry = setTimeout(() => void this.connect(s), 2000);
      });
    } catch {
      if (!this.stopped) this.retry = setTimeout(() => void this.connect(s), 5000);
    }
  }
  close() {
    this.stopped = true;
    clearTimeout(this.retry);
    this.socket?.close();
  }
}
