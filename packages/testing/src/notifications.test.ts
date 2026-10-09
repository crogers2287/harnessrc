import test from 'node:test';
import assert from 'node:assert/strict';
import { notificationFor } from '../../../apps/web/src/notifications.ts';
import type { Event, SessionView } from '@harnessrc/protocol';

test('notifications ignore status churn and replay, group real events per session with precise links', () => {
  const session = {
    id: 'session-one',
    project: 'Project',
    sessionName: 'Haxor work',
  } as SessionView;
  const event = {
    id: 'event-one',
    sourceId: 'native-event-one',
    nativeSessionId: 'native-session',
    source: 'dsh',
    sequence: 1,
    sessionId: session.id,
    timestamp: new Date(2000).toISOString(),
    kind: 'question',
    data: { interactionId: 'question-one' },
  } as Event;
  assert.equal(notificationFor(event, session, 3000), undefined);
  assert.equal(notificationFor(event, { ...session, archived: true }, 1000), undefined);
  for (const kind of ['agent.status', 'connection.state', 'assistant.message', 'turn.completed'])
    assert.equal(notificationFor({ ...event, kind } as Event, session, 1000), undefined);
  const question = notificationFor(event, session, 1000)!;
  assert.equal(question.label, 'Your agent needs input');
  assert.equal(question.options.data.path, '/?session=session-one&interaction=question-one');
  assert.equal(question.options.body, 'Haxor work');
  const failed = notificationFor(
    { ...event, id: 'event-two', kind: 'turn.failed' },
    session,
    1000,
  )!;
  assert.equal(failed.options.tag, question.options.tag);
  assert.equal(failed.options.renotify, false);
  assert.notEqual(failed.key, question.key);
});
