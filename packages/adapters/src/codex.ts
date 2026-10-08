import net from 'node:net';
import { randomUUID } from 'node:crypto';
import {
  capabilities,
  type Adapter,
  type Session,
  type Task,
  type Interaction,
  type InteractionInput,
  type SourceEvent,
} from '@harnessrc/protocol';
export function bridgeRequest(socketPath: string, method: string, params: unknown): Promise<any> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    const id = randomUUID();
    let buf = '';
    let finished = false;
    const finish = (e?: Error, r?: unknown) => {
      if (finished) return;
      finished = true;
      socket.destroy();
      if (e) reject(e);
      else resolve(r);
    };
    socket.setTimeout(10000, () =>
      finish(new Error('Native bridge timeout; delivery may be uncertain')),
    );
    socket.on('connect', () => socket.write(JSON.stringify({ id, method, params }) + '\n'));
    socket.on('error', (e) => finish(e));
    socket.on('close', () => finish(new Error('Native bridge disconnected')));
    socket.on('data', (chunk) => {
      buf += chunk;
      if (buf.length > 16 * 1024 * 1024) return finish(new Error('Bridge response too large'));
      const nl = buf.indexOf('\n');
      if (nl < 0) return;
      try {
        const r = JSON.parse(buf.slice(0, nl));
        if (r.error) finish(new Error(r.error));
        else finish(undefined, r.result);
      } catch (e) {
        finish(e as Error);
      }
    });
  });
}
export class CodexBridgeAdapter implements Adapter {
  capabilities = capabilities([
    'readConversation',
    'streamConversation',
    'sendMessage',
    'queueTask',
    'answerQuestion',
    'approveAction',
    'rejectAction',
    'steerActiveTurn',
    'interruptTurn',
    'readDiffs',
  ]);
  private offsets = new Map<string, number>();
  constructor(private socket: string, private checkBinding?: (session: Session) => Promise<void>) {}
  private call(session: Session, method: string, params: Record<string, unknown> = {}) {
    return bridgeRequest(this.socket, method, { ...params, sessionId: session.nativeSessionId });
  }
  async read(session: Session): Promise<SourceEvent[]> {
    const result = await this.call(session, 'snapshot', { eventOffset: this.offsets.get(session.id) ?? 0, limit: 1000 });
    if (typeof result.nextOffset === 'number') this.offsets.set(session.id, result.nextOffset);
    return result.events;
  }
  async interactions(session: Session): Promise<InteractionInput[]> {
    return (await this.call(session, 'snapshot', { includeEvents: false })).interactions;
  }
  async send(session: Session, task: Task) {
    if (!this.capabilities.sendMessage) throw new Error('Native send capability unavailable');
    await this.checkBinding?.(session);
    return this.call(session, 'send', { taskId: task.id, prompt: task.prompt });
  }
  async reconcile(session: Session, task: Task) {
    return (await this.call(session, 'task', { taskId: task.id })).status;
  }
  async respond(session: Session, interaction: Interaction, response: unknown) {
    await this.call(session, 'respond', { nativeRequestId: interaction.nativeRequestId, response });
  }
  async steer(session: Session, prompt: string) {
    await this.call(session, 'steer', { prompt });
  }
  async interrupt(session: Session) {
    await this.call(session, 'interrupt');
  }
}
export function codexRequestInteraction(request: any): InteractionInput | undefined {
  const p = request.params ?? {};
  const nativeRequestId = String(request.id);
  const common = {
    nativeRequestId,
    turnId: p.turnId,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    route: 'codex-bridge' as const,
      metadata: { method: request.method, itemId: p.itemId, command: p.command, cwd: p.cwd },
    default: undefined,
  };
  if (
    ['item/commandExecution/requestApproval', 'item/fileChange/requestApproval'].includes(
      request.method,
    )
  ) {
    /* Session-wide grants are intentionally not offered. */ return {
      ...common,
      type: request.method.includes('commandExecution') ? 'command-approval' : 'file-approval',
      prompt: p.command ?? p.reason ?? 'Allow the proposed file changes?',
      choices: [
        { id: 'accept', label: 'Allow once' },
        { id: 'decline', label: 'Deny' },
      ],
      responseSchema: { type: 'string', enum: ['accept', 'decline'] },
    };
  }
  if (request.method === 'item/tool/requestUserInput') {
    const questions = p.questions ?? [];
    const properties: Record<string, unknown> = {};
    for (const q of questions)
      properties[q.id] = {
        type: 'object',
        properties: {
          answers: {
            type: 'array',
            minItems: 1,
            items: { type: 'string', minLength: 1 },
            uniqueItems: true,
          },
        },
        required: ['answers'],
        additionalProperties: false,
      };
    return {
      ...common,
      type: 'free-text',
      prompt: questions.map((q: any) => q.question).join('\n\n'),
      choices: [],
      responseSchema: {
        type: 'object',
        properties: {
          answers: {
            type: 'object',
            properties,
            required: questions.map((q: any) => q.id),
            additionalProperties: false,
          },
        },
        required: ['answers'],
        additionalProperties: false,
      },
      metadata: { ...common.metadata, questions },
    };
  }
  return undefined;
}
export function normalizeCodexNotification(
  method: string,
  p: any,
  sequence: number,
): SourceEvent[] {
  const timestamp = new Date().toISOString();
  const common = { sourceId: `native:${sequence}`, timestamp, turnId: p.turnId ?? p.turn?.id };
  if (method === 'item/agentMessage/delta')
    return [{ ...common, kind: 'assistant.delta', data: { itemId: p.itemId, text: p.delta } }];
  if (method === 'turn/started')
    return [{ ...common, kind: 'turn.started', data: { turnId: p.turn.id } }];
  if (method === 'turn/completed')
    return [
      {
        ...common,
        kind: p.turn.status === 'failed' ? 'turn.failed' : 'turn.completed',
        data: { turnId: p.turn.id, status: p.turn.status, error: p.turn.error },
      },
    ];
  if (method === 'turn/diff/updated') return [{ ...common, kind: 'diff', data: { text: p.diff } }];
  if (method === 'turn/plan/updated')
    return [{ ...common, kind: 'plan', data: { text: p.explanation, steps: p.plan } }];
  if (method === 'item/started' || method === 'item/completed') {
    const item = p.item ?? {};
    const completed = method === 'item/completed';
    if (item.type === 'agentMessage' && completed)
      return [{ ...common, kind: 'assistant.message', data: { text: item.text, itemId: item.id } }];
    if (item.type === 'userMessage' && completed)
      return [{ ...common, kind: 'user.message', data: { text: textFromItems(item.content) } }];
    if (item.type === 'commandExecution')
      return [
        {
          ...common,
          kind: completed ? 'tool.completion' : 'tool.invocation',
          data: {
            tool: 'Shell',
            toolId: item.id,
            input: item.command,
            output: item.aggregatedOutput,
            status: item.status,
          },
        },
      ];
    if (item.type === 'fileChange')
      return [
        { ...common, kind: 'file.change', data: { changes: item.changes, status: item.status } },
      ];
    if (item.type === 'reasoning' && completed && item.summary?.length)
      return [{ ...common, kind: 'reasoning.summary', data: { text: item.summary.join('\n') } }];
  }
  return [];
}
function textFromItems(content: any[]) {
  return (content ?? [])
    .filter((x) => x.type === 'text')
    .map((x) => x.text)
    .join('\n');
}
