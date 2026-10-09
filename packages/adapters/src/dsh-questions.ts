import WebSocket from 'ws';
import { z } from 'zod';
import type { InteractionInput } from '@harnessrc/protocol';
import type { DshClient } from './dsh.ts';
export const dshQuestionSchema = z.object({
  id: z.string(),
  question: z.string(),
  detail: z.string().optional(),
  header: z.string().optional(),
  options: z.array(z.object({ label: z.string(), description: z.string().optional() })).optional(),
  multiSelect: z.boolean().optional(),
});
const frameSchema = z.object({
  eventId: z.string(),
  agentId: z.string(),
  request: z.object({
    questions: z.array(dshQuestionSchema).min(1),
    wait: z.object({ callId: z.string(), timed: z.boolean().optional() }).optional(),
  }),
});
type Frame = z.infer<typeof frameSchema>;
export const dshAnswerSchema = z
  .object({
    answers: z
      .array(
        z
          .object({
            id: z.string(),
            selected: z.array(z.string()),
            custom: z.string().max(32000).optional(),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();
/** One host-wide native event subscription; pending waterfalls replay on reconnect. */
export class DshQuestions {
  private socket?: WebSocket;
  private clientId?: string;
  private pending = new Map<string, Frame>();
  private retry?: NodeJS.Timeout;
  private stopped = false;
  private connecting = false;
  constructor(
    private endpoint: string,
    private credential: () => Promise<string>,
    private native: DshClient,
  ) {}
  async start() {
    if (this.stopped || this.socket || this.connecting) return;
    this.connecting = true;
    try {
      const cookie = await this.credential();
      if (this.stopped) return;
      const url = new URL('/api/remote.mux', this.endpoint);
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(url, {
        headers: { Cookie: cookie, Origin: new URL(this.endpoint).origin },
        maxPayload: 4 * 1024 * 1024,
      });
      this.socket = ws;
      ws.on('open', () =>
        ws.send(
          JSON.stringify({
            type: 'open',
            streamId: 'questions',
            endpoint: '$events',
            payload: { args: {} },
          }),
        ),
      );
      ws.on('message', (bytes) => {
        try {
          const envelope = JSON.parse(bytes.toString());
          // Claim streams end normally when their question settles. Only the
          // host-wide event stream controls connection/replay lifetime.
          if (envelope.streamId?.startsWith('wait:')) {
            if (envelope.type === 'error') ws.close();
            return;
          }
          if (envelope.type === 'error' || envelope.type === 'end') {
            ws.close();
            return;
          }
          if (envelope.type !== 'item') return;
          const value = envelope.value;
          if (value.type === 'ready') {
            this.pending.clear();
            this.clientId = z.string().parse(value.clientId);
          }
          if (value.type === 'cancel') this.release(value.eventId);
          if (value.type === 'waterfall') {
            if (value.event === 'user-questions/request') {
              const frame = frameSchema.parse(value);
              const previous = this.pending.has(frame.eventId);
              this.pending.set(frame.eventId, frame);
              if (!previous && frame.request.wait?.timed) {
                // Hold on the gateway, independently of phone connections. DSH
                // suspends its unattended timer for this stream's lifetime.
                ws.send(
                  JSON.stringify({
                    type: 'open',
                    streamId: `wait:${frame.eventId}`,
                    endpoint: 'userQuestions/attachWait',
                    payload: {
                      args: { agentId: frame.agentId, callId: frame.request.wait.callId },
                    },
                  }),
                );
              }
            } else if (this.clientId) {
              // Delegate unsupported native interactions to other clients; never approve them.
              void this.native
                .call('$events/result', {
                  clientId: this.clientId,
                  eventId: value.eventId,
                  outcome: { kind: 'next' },
                })
                .catch(() => ws.close());
            }
          }
        } catch {
          ws.close();
        }
      });
      ws.on('error', () => ws.close());
      ws.on('close', () => {
        if (this.socket === ws) {
          this.socket = undefined;
          this.clientId = undefined;
          this.pending.clear();
        }
        if (!this.stopped) this.retry = setTimeout(() => void this.start(), 1500);
      });
    } catch {
      if (!this.stopped) this.retry = setTimeout(() => void this.start(), 3000);
    } finally {
      this.connecting = false;
    }
  }
  interactions(sessionId: string): InteractionInput[] {
    if (!this.clientId) throw new Error('Reconnecting DSH question channel');
    return [...this.pending.values()]
      .filter((f) => f.agentId === sessionId)
      .map((f) => ({
        nativeRequestId: f.eventId,
        type: 'free-text',
        prompt:
          f.request.questions.length === 1
            ? f.request.questions[0].question
            : 'DSH needs your input',
        choices: [],
        responseSchema: { type: 'object' },
        expiresAt: '9999-12-31T23:59:59.999Z',
        route: 'dsh-native',
        metadata: { dshQuestions: f.request.questions },
      }));
  }
  hasPending(sessionId: string) {
    return [...this.pending.values()].some((f) => f.agentId === sessionId);
  }
  validate(sessionId: string, eventId: string, input: unknown) {
    const frame = this.pending.get(eventId),
      clientId = this.clientId;
    if (!frame || frame.agentId !== sessionId || !clientId)
      throw new Error('DSH question is no longer pending');
    const answer = dshAnswerSchema.parse(input);
    if (
      answer.answers.length !== frame.request.questions.length ||
      new Set(answer.answers.map((a) => a.id)).size !== answer.answers.length
    )
      throw new Error('Answer every DSH question exactly once');
    for (const q of frame.request.questions) {
      const a = answer.answers.find((a) => a.id === q.id);
      if (
        !a ||
        (!a.selected.length && !a.custom?.trim()) ||
        (!q.multiSelect && a.selected.length + (a.custom?.trim() ? 1 : 0) > 1) ||
        new Set(a.selected).size !== a.selected.length ||
        a.selected.some((v) => !q.options?.some((o) => o.label === v))
      )
        throw new Error('Invalid DSH question response');
    }
    return { answer, clientId };
  }
  async respond(sessionId: string, eventId: string, input: unknown) {
    const { answer, clientId } = this.validate(sessionId, eventId, input);
    await this.native.call('$events/result', {
      clientId,
      eventId,
      outcome: { kind: 'result', value: answer },
    });
    // Release only AFTER the Host accepted the native result.
    this.release(eventId);
  }
  private release(eventId: string) {
    const frame = this.pending.get(eventId);
    this.pending.delete(eventId);
    if (frame?.request.wait?.timed && this.socket?.readyState === WebSocket.OPEN)
      this.socket.send(JSON.stringify({ type: 'cancel', streamId: `wait:${eventId}` }));
  }
  close() {
    this.stopped = true;
    clearTimeout(this.retry);
    this.socket?.close();
    this.pending.clear();
    this.clientId = undefined;
  }
}
