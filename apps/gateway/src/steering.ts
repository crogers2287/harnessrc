import { createHash } from 'node:crypto';
import type { Store } from '@harnessrc/storage';

/** Claim before native delivery. An interrupted attempt is never blindly retried. */
export async function deliverSteer(
  store: Store,
  requestId: string,
  deviceId: string,
  sessionId: string,
  prompt: string,
  deliver: () => Promise<void>,
) {
  const hash = createHash('sha256').update(prompt).digest('hex');
  const claimed = store.db
    .prepare("INSERT OR IGNORE INTO steering_receipts VALUES(?,?,?,?,'sending',?)")
    .run(requestId, deviceId, sessionId, hash, new Date().toISOString()).changes;
  if (!claimed) {
    const prior = store.db
      .prepare('SELECT * FROM steering_receipts WHERE request_id=?')
      .get(requestId)!;
    if (
      prior.device_id !== deviceId ||
      prior.session_id !== sessionId ||
      prior.payload_hash !== hash
    )
      throw new Error('Steering request identity conflicts with an earlier request');
    if (prior.status === 'confirmed') return { ok: true };
    throw new Error(
      'Steering delivery is not confirmed. Check the conversation before sending again.',
    );
  }
  try {
    await deliver();
    store.db
      .prepare("UPDATE steering_receipts SET status='confirmed' WHERE request_id=?")
      .run(requestId);
    return { ok: true };
  } catch (error) {
    store.db
      .prepare("UPDATE steering_receipts SET status='uncertain' WHERE request_id=?")
      .run(requestId);
    throw error;
  }
}
