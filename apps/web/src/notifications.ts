import type { Event, SessionView } from '@harnessrc/protocol';

/** Only durable native events trigger alerts. Connection/session-status churn never does. */
export function notificationFor(event: Event, session: SessionView, openedAt: number) {
  if (session.archived || Date.parse(event.timestamp) < openedAt) return;
  const label =
    event.kind === 'question' || event.kind === 'approval.request'
      ? 'Your agent needs input'
      : event.kind === 'task.completed'
        ? 'Task complete'
        : event.kind === 'turn.failed'
          ? 'Agent needs attention'
          : undefined;
  if (!label) return;
  const interaction =
    typeof event.data.interactionId === 'string' ? event.data.interactionId : undefined;
  return {
    label,
    key: `${session.id}:${event.id}`,
    options: {
      body: session.relayName || session.sessionName || session.project,
      tag: `relay-session:${session.id}`,
      renotify: false,
      data: {
        path: `/?session=${encodeURIComponent(session.id)}${interaction ? `&interaction=${encodeURIComponent(interaction)}` : ''}`,
      },
    },
  };
}
const openedAt = Date.now();
const memory = new Set<string>();
export async function notifyEvent(event: Event, session?: SessionView) {
  if (!session || !('Notification' in window) || Notification.permission !== 'granted') return;
  const note = notificationFor(event, session, openedAt);
  if (!note) return;
  try {
    if (localStorage.getItem('relay-notifications') !== 'on') return;
    const saved: unknown = JSON.parse(localStorage.getItem('relay-notified-events') || '[]');
    const keys = Array.isArray(saved) ? saved.filter((x) => typeof x === 'string') : [];
    if (memory.has(note.key) || keys.includes(note.key)) return;
    memory.add(note.key);
    localStorage.setItem('relay-notified-events', JSON.stringify([...keys, note.key].slice(-500)));
    // The current conversation already displays its question/error/completion.
    if (
      document.visibilityState === 'visible' &&
      new URL(location.href).searchParams.get('session') === session.id
    )
      return;
    const registration = await navigator.serviceWorker?.getRegistration();
    if (registration) await registration.showNotification(note.label, note.options);
    else {
      const notification = new Notification(note.label, note.options);
      notification.onclick = () => location.assign(note.options.data.path);
    }
  } catch {
    /* Notifications must never block or break conversation updates. */
  }
}
