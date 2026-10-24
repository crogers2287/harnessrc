import { z } from 'zod';
import type { Store } from '@harnessrc/storage';

export const helperNoticeSchema = z
  .object({
    requestId: z.string().uuid(),
    title: z.string().trim().min(1).max(100),
    body: z.string().trim().min(1).max(400),
  })
  .strict();

export class HelperAttention {
  constructor(
    private store: Store,
    readonly enabled: boolean,
    readonly waitingMinutes: number,
  ) {}
  pending(now = Date.now()) {
    const sessions = new Map(this.store.sessions().map((session) => [session.id, session]));
    return this.store.db
      .prepare("SELECT body FROM interactions WHERE status='pending'")
      .all()
      .flatMap((row) => {
        const interaction = JSON.parse(String(row.body));
        const session = sessions.get(interaction.sessionId);
        if (
          !session ||
          !session.connected ||
          session.status === 'ended' ||
          interaction.generation !== session.generation ||
          (interaction.expiresAt && Date.parse(interaction.expiresAt) <= now) ||
          this.store.db
            .prepare('SELECT archived FROM session_preferences WHERE session_id=?')
            .get(session.id)?.archived
        )
          return [];
        const opened = this.store.db
          .prepare(
            `SELECT body FROM events WHERE session_id=?
          AND json_extract(body,'$.kind') IN ('question','approval.request')
          AND json_extract(body,'$.data.interactionId')=? ORDER BY sequence LIMIT 1`,
          )
          .get(session.id, interaction.id);
        const createdAt = opened ? JSON.parse(String(opened.body)).timestamp : undefined;
        const since = Date.parse(createdAt);
        if (!Number.isFinite(since)) return [];
        const preference = this.store.db
          .prepare('SELECT name FROM session_preferences WHERE session_id=?')
          .get(session.id);
        return [
          {
            sessionId: session.id,
            generation: session.generation,
            interactionId: interaction.id,
            name: String(preference?.name || session.sessionName || session.project),
            prompt: String(interaction.prompt).slice(0, 1000),
            createdAt,
            waitingMinutes: Math.max(0, Math.floor((now - since) / 60000)),
            type: interaction.type,
          },
        ];
      })
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  view() {
    return { enabled: this.enabled, waitingMinutes: this.waitingMinutes, items: this.pending() };
  }
  tick(now = Date.now()) {
    if (!this.enabled) return;
    let emitted = 0;
    for (const item of this.pending(now).filter((i) => i.waitingMinutes >= this.waitingMinutes)) {
      const sourceId = `helper:waiting:${item.interactionId}`;
      if (
        this.store.db
          .prepare('SELECT 1 FROM events WHERE session_id=? AND source_id=?')
          .get(item.sessionId, sourceId)
      )
        continue;
      this.store.event(this.store.session(item.sessionId), {
        sourceId,
        kind: 'agent.status',
        timestamp: new Date(now).toISOString(),
        data: {
          helperAlert: true,
          interactionId: item.interactionId,
          title: 'Session waiting for your answer',
          text: `${item.name} has waited ${item.waitingMinutes} minutes for your answer. Open the session to respond.`,
        },
      });
      if (++emitted === 20) break;
    }
  }
  notify(sessionId: string, input: z.infer<typeof helperNoticeSchema>, device: string) {
    const session = this.store.session(sessionId);
    const sourceId = `helper:notice:${input.requestId}`;
    const saved = this.store.db
      .prepare('SELECT body FROM events WHERE session_id=? AND source_id=?')
      .get(sessionId, sourceId);
    if (saved) {
      const event = JSON.parse(String(saved.body));
      if (event.data.title !== input.title || event.data.text !== input.body)
        throw new Error('Notification request ID was already used for different content');
      return { accepted: true, eventId: event.id, requestId: input.requestId };
    }
    const event = this.store.event(session, {
      sourceId,
      kind: 'agent.status',
      timestamp: new Date().toISOString(),
      data: { helperAlert: true, title: input.title, text: input.body },
    });
    this.store.audit(device, 'helper.notify', sessionId, {
      requestId: input.requestId,
      eventId: event.id,
    });
    return { accepted: true, eventId: event.id, requestId: input.requestId };
  }
}
