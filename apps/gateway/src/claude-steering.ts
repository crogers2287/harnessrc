import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Session, Task } from '@harnessrc/protocol';
import type { Runtime } from './runtime.ts';

const payloadSchema = z.object({
  session_id: z.string().min(1),
  hook_event_name: z.enum([
    'SessionStart',
    'UserPromptSubmit',
    'PreToolUse',
    'PostToolUse',
    'PostToolUseFailure',
    'Stop',
  ]),
  sender_pids: z.array(z.number().int().positive()).max(32),
  agent_id: z.string().optional(),
});

/** A mailbox consumed by the existing Claude process at a documented hook boundary.
 * Claim before output: a lost hook response is never automatically delivered twice.
 */
export class ClaudeSteering {
  constructor(private runtime: Runtime) {}
  available(s: Session): boolean {
    if (s.harness !== 'claude' || !s.processIdentity) return false;
    const row = this.runtime.store.db
      .prepare('SELECT * FROM claude_hook_bindings WHERE session_id=?')
      .get(s.id);
    return row?.generation === s.generation && row?.process_identity === s.processIdentity;
  }
  async submit(s: Session, prompt: string, input?: Pick<Task, 'id' | 'prompt' | 'attachments'>) {
    await this.runtime.assertBinding(s);
    if (!this.available(s))
      throw new Error('Claude steering hook has not connected to this process yet');
    const id = input?.id ?? randomUUID();
    const attachments = JSON.stringify(input?.attachments ?? []);
    const prior = this.runtime.store.db
      .prepare('SELECT * FROM claude_hook_messages WHERE id=?')
      .get(id);
    if (prior) {
      if (
        prior.session_id !== s.id ||
        prior.generation !== s.generation ||
        prior.prompt !== prompt ||
        prior.attachments !== attachments
      )
        throw new Error('Claude steering request identity conflict');
      return;
    }
    this.runtime.store.db
      .prepare("INSERT INTO claude_hook_messages VALUES(?,?,?,?,?,?,?,'pending',NULL,?)")
      .run(
        id,
        s.id,
        s.generation,
        s.processIdentity!,
        prompt,
        input?.prompt ?? prompt,
        attachments,
        new Date().toISOString(),
      );
  }
  async handle(method: 'steer-poll' | 'steer-ack', invocation: string, payload: unknown) {
    const h = payloadSchema.parse(payload);
    // A subagent's hooks can carry the parent's session_id. Never steal its instructions.
    if (h.agent_id) return { output: {} };
    const matches = this.runtime.store
      .sessions()
      .filter((s) => s.harness === 'claude' && s.connected && s.nativeSessionId === h.session_id);
    if (matches.length !== 1)
      throw new Error('Claude hook is not uniquely bound to a live Herdr process');
    const s = matches[0];
    await this.runtime.assertBinding(s);
    if (!s.processIdentity) throw new Error('Claude process identity is unavailable');
    if (!h.sender_pids.includes(Number(s.processIdentity.split(':')[1])))
      throw new Error('Hook does not descend from the bound Claude process');
    const store = this.runtime.store;
    if (!this.available(s)) {
      store.db
        .prepare('INSERT OR REPLACE INTO claude_hook_bindings VALUES(?,?,?)')
        .run(s.id, s.generation, s.processIdentity);
      s.capabilities = { ...s.capabilities, steerActiveTurn: true };
      store.saveSession(s);
      this.runtime.emit('change');
    }
    store.db
      .prepare(
        "UPDATE claude_hook_messages SET status='stale' WHERE session_id=? AND status IN ('pending','claimed') AND (generation!=? OR process_identity!=?)",
      )
      .run(s.id, s.generation, s.processIdentity);
    if (method === 'steer-ack') {
      const rows = store.db
        .prepare(
          "SELECT * FROM claude_hook_messages WHERE session_id=? AND generation=? AND process_identity=? AND invocation_id=? AND status IN ('claimed','delivered')",
        )
        .all(s.id, s.generation, s.processIdentity, invocation);
      for (const row of rows) {
        const attachments = JSON.parse(String(row.attachments)).map((id: string) => {
          const file = this.runtime.attachments.get(s, id);
          return { id, name: file.name, mime: file.mime };
        });
        store.event(s, {
          sourceId: `claude-hook:steer:${row.id}`,
          kind: 'user.message',
          timestamp: String(row.created_at),
          data: {
            text: row.display_prompt,
            requestId: row.id,
            attachments,
            delivery: 'hook-context',
          },
        });
        if (row.status !== 'delivered')
          store.db
            .prepare("UPDATE claude_hook_messages SET status='delivered' WHERE id=?")
            .run(row.id);
      }
      return { output: {} };
    }
    // Start/prompt hooks register support but must not turn an old steer into a new turn.
    if (['SessionStart', 'UserPromptSubmit'].includes(h.hook_event_name)) return { output: {} };
    if (
      store
        .interactions(s.id)
        .some((i) => ['pending', 'responding', 'answered', 'uncertain'].includes(i.status))
    )
      return { output: {} };
    const rows = store.transaction(() => {
      const pending = store.db
        .prepare(
          "SELECT * FROM claude_hook_messages WHERE session_id=? AND generation=? AND process_identity=? AND status='pending' ORDER BY rowid LIMIT 4",
        )
        .all(s.id, s.generation, s.processIdentity!);
      for (const row of pending)
        store.db
          .prepare(
            "UPDATE claude_hook_messages SET status='claimed',invocation_id=? WHERE id=? AND status='pending'",
          )
          .run(invocation, row.id);
      return pending;
    });
    if (!rows.length) return { output: {} };
    const context =
      'The user sent these instructions through Relay for your current work. Apply them now, respecting existing permissions:\n\n' +
      rows.map((r) => String(r.prompt)).join('\n\n');
    return {
      output:
        h.hook_event_name === 'Stop'
          ? { decision: 'block', reason: context }
          : {
              hookSpecificOutput: { hookEventName: h.hook_event_name, additionalContext: context },
            },
      acknowledge: true,
    };
  }
}
