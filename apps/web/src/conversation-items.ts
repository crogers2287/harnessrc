import type { Event } from '@harnessrc/protocol';
export function conversationItems(events: Event[], activity = 'grouped'): Event[] {
  const replaced = new Set(
    events.flatMap((e) =>
      Array.isArray(e.data.replacesEventSourceIds) ? e.data.replacesEventSourceIds : [],
    ),
  );
  events = events.filter((e) => !replaced.has(e.sourceId));
  const completed = new Set(
    events.filter((e) => e.kind === 'assistant.message' && e.data.itemId).map((e) => e.data.itemId),
  );
  const deltas = new Map<unknown, Event>();
  const output: Event[] = [];
  for (const e of events) {
    if (e.data.nativeMeta) continue;
    if (e.kind === 'assistant.delta') {
      const key = e.data.itemId;
      if (completed.has(key)) continue;
      const existing = deltas.get(key);
      if (existing) existing.data.text = String(existing.data.text) + String(e.data.text);
      else {
        const item = { ...e, data: { ...e.data } };
        deltas.set(key, item);
        output.push(item);
      }
    } else if (
      ![
        'turn.started',
        'turn.completed',
        'task.queued',
        'task.dispatched',
        'task.completed',
        'connection.state',
        'agent.status',
        'question',
        'approval.request',
        'approval.response',
      ].includes(e.kind)
    )
      output.push(e);
  }
  if (activity === 'responses')
    return output.filter((e) => !e.kind.startsWith('tool.') && e.kind !== 'reasoning.summary');
  if (activity === 'everything') return output;
  const grouped: Event[] = [];
  for (const event of output) {
    const previous = grouped[grouped.length - 1];
    if (event.kind.startsWith('tool.') || event.kind === 'reasoning.summary') {
      if (previous?.data.activityGroup) (previous.data.activities as Event[]).push(event);
      else grouped.push({ ...event, data: { activityGroup: true, activities: [event] } });
    } else grouped.push(event);
  }
  return grouped;
}
