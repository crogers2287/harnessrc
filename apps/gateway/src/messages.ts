import { createHash } from 'node:crypto';
import { taskInputSchema, type Task } from '@harnessrc/protocol';
import type { Runtime } from './runtime.ts';

/** Send/steer is resolved from current native state, never from a stale phone status. */
export async function sendMessage(
  runtime: Runtime,
  sessionId: string,
  deviceId: string,
  input: unknown,
) {
  const value = taskInputSchema.parse(input);
  const store = runtime.store;
  const hash = createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const prior = store.db
    .prepare('SELECT * FROM message_receipts WHERE request_id=?')
    .get(value.idempotencyKey);
  if (prior) {
    if (
      prior.device_id !== deviceId ||
      prior.session_id !== sessionId ||
      prior.payload_hash !== hash
    )
      throw new Error('Message request identity conflicts with an earlier request');
    if (prior.status === 'confirmed')
      return JSON.parse(prior.result as string) as { mode: 'send' | 'steer'; task?: Task };
    throw new Error(
      'Message delivery is not confirmed. It will not be queued or automatically resent.',
    );
  }
  store.db
    .prepare("INSERT INTO message_receipts VALUES(?,?,?,?,'sending',NULL,?)")
    .run(value.idempotencyKey, deviceId, sessionId, hash, new Date().toISOString());
  try {
    const session = store.session(sessionId);
    await runtime.assertBinding(session);
    const adapter = runtime.adapters.get(sessionId);
    if (!adapter?.turnState)
      throw new Error('Native turn state is unavailable. Your message was not queued.');
    if (
      store
        .interactions(sessionId)
        .some((i) => ['pending', 'responding', 'answered', 'uncertain'].includes(i.status))
    )
      throw new Error('Reply to the pending interaction first. Your message was not queued.');
    const state = await adapter.turnState(session);
    let result: { mode: 'send' | 'steer'; task?: Task };
    if (state === 'working') {
      if (!session.capabilities.steerActiveTurn || !adapter.steer)
        throw new Error(
          'This agent does not support native steering. Choose Queue explicitly for a later turn.',
        );
      if (value.attachments.length)
        throw new Error(
          'Native steering currently accepts text only. Your files and message were not queued.',
        );
      await adapter.steer(session, value.prompt);
      result = { mode: 'steer' };
    } else if (state === 'idle' || state === 'done') {
      result = { mode: 'send', task: await runtime.queue.sendNow(sessionId, value) };
    } else throw new Error('The agent is not ready for a message. Your message was not queued.');
    store.db
      .prepare("UPDATE message_receipts SET status='confirmed',result=? WHERE request_id=?")
      .run(JSON.stringify(result), value.idempotencyKey);
    store.audit(deviceId, result.mode === 'steer' ? 'turn.steer' : 'message.send', sessionId, {
      requestId: value.idempotencyKey,
    });
    return result;
  } catch (error) {
    store.db
      .prepare("UPDATE message_receipts SET status='uncertain' WHERE request_id=?")
      .run(value.idempotencyKey);
    throw error;
  }
}
