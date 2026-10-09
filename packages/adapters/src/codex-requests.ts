import { createHash } from 'node:crypto';
import { codexRequestInteraction } from './codex.ts';
import type { InteractionInput } from '@harnessrc/protocol';

/** Pending requests belong to this native connection, never to transcript guesses. */
export class CodexRequests {
  private requests = new Map<string, { request: any; input: InteractionInput; sent: boolean }>();
  private waiters = new Map<
    string,
    { resolve: () => void; reject: (e: Error) => void; timer: NodeJS.Timeout }
  >();
  receive(message: any) {
    if (message.method === 'serverRequest/resolved') {
      for (const [key, entry] of this.requests) {
        if (
          entry.request.id === message.params?.requestId &&
          entry.request.params.threadId === message.params?.threadId
        ) {
          this.requests.delete(key);
          const waiter = this.waiters.get(key);
          if (waiter) {
            clearTimeout(waiter.timer);
            this.waiters.delete(key);
            waiter.resolve();
          }
        }
      }
      return;
    }
    if (message.id === undefined || typeof message.params?.threadId !== 'string') return;
    // Initial implementation handles structured questions only. Do not claim arbitrary tools/approvals.
    if (message.method !== 'item/tool/requestUserInput') return;
    if (
      !Array.isArray(message.params.questions) ||
      !message.params.questions.length ||
      !message.params.questions.every(
        (q: any) => typeof q.id === 'string' && typeof q.question === 'string',
      )
    )
      return;
    const input = codexRequestInteraction(message);
    if (!input) return;
    const key = createHash('sha256')
      .update(
        JSON.stringify([
          message.id,
          message.params.threadId,
          message.params.turnId,
          message.params.itemId,
          message.params.questions,
        ]),
      )
      .digest('hex');
    if (this.requests.has(key)) return;
    this.requests.set(key, {
      request: message,
      sent: false,
      input: {
        ...input,
        nativeRequestId: key,
        route: 'codex-native',
        expiresAt: '2100-01-01T00:00:00.000Z',
      },
    });
  }
  list(threadId: string) {
    return [...this.requests.values()]
      .filter((e) => e.request.params.threadId === threadId)
      .map((e) => e.input);
  }
  async respond(threadId: string, id: string, response: unknown, send: (frame: unknown) => void) {
    const entry = this.requests.get(id);
    if (!entry || entry.request.params.threadId !== threadId)
      throw new Error('Native question is no longer available');
    if (entry.sent)
      throw new Error('A response was already submitted; awaiting native confirmation');
    entry.sent = true;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters.delete(id);
        reject(new Error('Native question response is unconfirmed; do not resend'));
      }, 5000);
      this.waiters.set(id, { resolve, reject, timer });
      try {
        send({ id: entry.request.id, result: response });
      } catch (error) {
        clearTimeout(timer);
        this.waiters.delete(id);
        reject(error);
      }
    });
  }
  disconnect() {
    this.requests.clear();
    for (const waiter of this.waiters.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error('Native question connection lost; delivery is uncertain'));
    }
    this.waiters.clear();
  }
}
