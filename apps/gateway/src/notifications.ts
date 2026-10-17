import type { Event } from '@harnessrc/protocol';
import type { Store } from '@harnessrc/storage';
import type { Auth, Device } from './auth.ts';

// The cursor is global, but every item is authorized before any session data leaves the server.
export function notificationFeed(
  store: Store,
  auth: Auth,
  device: Device,
  after: number | undefined,
  since: number,
) {
  const pendingQuestions = [
    ...new Set(
      store.db
        .prepare("SELECT session_id,body FROM interactions WHERE status='pending'")
        .all()
        .filter((row) => {
          if (!auth.allowed(device, String(row.session_id))) return false;
          const request = JSON.parse(String(row.body));
          return !request.expiresAt || Date.parse(request.expiresAt) > Date.now();
        })
        .map((row) => String(row.session_id)),
    ),
  ];
  const high = Number(
    store.db.prepare('SELECT COALESCE(MAX(sequence),0) AS n FROM events').get()!.n,
  );
  if (after === undefined || after > high)
    return { cursor: high, items: [], more: false, pendingQuestions };
  const rows = store.db
    .prepare(
      `SELECT sequence,body FROM events WHERE sequence>? AND sequence<=?
    AND json_extract(body,'$.kind') IN ('question','approval.request','turn.completed','turn.failed','task.completed')
    ORDER BY sequence LIMIT 200`,
    )
    .all(after, high);
  const items = rows.flatMap((row) => {
    const event = JSON.parse(String(row.body)) as Event;
    if (!auth.allowed(device, event.sessionId)) return [];
    const session = store.session(event.sessionId);
    const preference = store.db
      .prepare('SELECT name,archived FROM session_preferences WHERE session_id=?')
      .get(session.id);
    if (
      preference?.archived ||
      !Number.isFinite(Date.parse(event.timestamp)) ||
      Date.parse(event.timestamp) < Math.max(since, Date.now() - 86400000)
    )
      return [];
    const question = ['question', 'approval.request'].includes(event.kind);
    const interactionId =
      typeof event.data.interactionId === 'string' ? event.data.interactionId : '';
    if (question) {
      const interaction = store.interactions(session.id).find((i) => i.id === interactionId);
      if (
        !interaction ||
        interaction.sessionId !== session.id ||
        interaction.status !== 'pending' ||
        (interaction.expiresAt && Date.parse(interaction.expiresAt) <= Date.now())
      )
        return [];
    }
    return [
      {
        id: event.id,
        sessionId: session.id,
        interactionId,
        kind: question ? 'question' : event.kind === 'turn.failed' ? 'failure' : 'completion',
        title: question
          ? 'Your agent needs input'
          : event.kind === 'turn.failed'
            ? 'Agent needs attention'
            : 'Turn complete',
        body: String(preference?.name || session.sessionName || session.project),
        timestamp: event.timestamp,
      },
    ];
  });
  return {
    cursor: rows.length === 200 ? Number(rows.at(-1)!.sequence) : high,
    more: rows.length === 200,
    items,
    pendingQuestions,
  };
}
