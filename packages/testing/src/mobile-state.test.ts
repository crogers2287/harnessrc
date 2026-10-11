import test from 'node:test';
import assert from 'node:assert/strict';
import { hasNativeEcho, type Outgoing } from '../../../apps/web/src/delivery.ts';
import {
  filterSessions,
  defaultFilters,
  sessionRecency,
} from '../../../apps/web/src/session-filters.ts';
import type { Event, SessionView } from '@harnessrc/protocol';
const at = '2026-10-09T01:00:00Z';
test('attachment echoes reconcile task IDs and already-saved optimistic cards without hiding different files', () => {
  const item: Outgoing = {
    key: 'browser-key',
    prompt: 'Review this',
    attachments: [{ id: 'photo-one', name: 'a.png', mime: 'image/png' }],
    started: at,
    state: 'confirmed',
  };
  const event = {
    id: 'native-message',
    sourceId: 'native-message',
    sessionId: 'session',
    nativeSessionId: 'native',
    source: 'codex',
    sequence: 1,
    kind: 'user.message',
    timestamp: at,
    data: { taskId: 'native-task', text: 'Review this', attachments: [{ id: 'photo-one' }] },
  } as Event;
  assert.equal(hasNativeEcho(item, [event]), true);
  assert.equal(
    hasNativeEcho({ ...item, nativeRequestId: 'native-task' }, [
      { ...event, timestamp: '2026-10-08T01:00:00Z' },
    ]),
    true,
  ); // old saved card without nativeRequestId
  assert.equal(
    hasNativeEcho({ ...item, nativeRequestId: 'native-task' }, [
      { ...event, data: { taskId: 'native-task' } },
    ]),
    true,
  );
  assert.equal(
    hasNativeEcho(item, [
      { ...event, data: { ...event.data, attachments: [{ id: 'other-file' }] } },
    ]),
    false,
  );
  assert.equal(hasNativeEcho(item, [{ ...event, timestamp: '2026-10-08T01:00:00Z' }]), false);
  assert.equal(hasNativeEcho(item, [{ ...event, kind: 'assistant.message' }]), false);
});
test('live/history agent filters combine multiword model search, directory, host, and native blocked states', () => {
  const base = {
    id: 'live',
    harness: 'dsh',
    presence: 'live',
    status: 'idle',
    lastActivity: at,
    cwd: '/projects/api',
    hostId: 'fred-dsh',
    model: 'gpt-6-astra',
    pendingCount: 0,
    project: 'API',
  } as SessionView;
  const sessions = [
    base,
    { ...base, id: 'saved', presence: 'saved' as const },
    { ...base, id: 'blocked', status: 'blocked' as const },
    { ...base, id: 'other', harness: 'codex' },
  ];
  assert.equal(filterSessions(sessions, { ...defaultFilters, agent: 'dsh' }).length, 2);
  assert.deepEqual(
    filterSessions(sessions, { ...defaultFilters, agent: 'dsh', scope: 'history' }).map(
      (s) => s.id,
    ),
    ['saved'],
  );
  assert.deepEqual(
    filterSessions(sessions, {
      ...defaultFilters,
      agent: 'dsh',
      status: 'attention',
      search: 'astra api',
      host: 'fred-dsh',
      cwd: '/projects/api',
    }).map((s) => s.id),
    ['blocked'],
  );
  assert.equal(filterSessions(sessions, { ...defaultFilters, agent: 'claude' }).length, 0);
});

test('session lists sort by the latest open or agent activity across harnesses', () => {
  const activity = {
    id: 'activity',
    harness: 'codex',
    presence: 'live',
    status: 'idle',
    lastActivity: '2026-10-10T03:00:00Z',
    cwd: '/projects/a',
    hostId: 'fred',
    pendingCount: 0,
    project: 'Activity',
  } as SessionView;
  const opened = {
    ...activity,
    id: 'opened',
    harness: 'dsh',
    lastActivity: '2026-10-09T01:00:00Z',
    project: 'Opened',
  } as SessionView;
  const lastOpened = { opened: '2026-10-11T03:30:00Z' };
  assert.deepEqual(
    filterSessions([activity, opened], defaultFilters, lastOpened).map((s) => s.id),
    ['opened', 'activity'],
  );
  assert.equal(sessionRecency(opened, lastOpened).source, 'Opened');
  assert.equal(sessionRecency(activity, lastOpened).source, 'Activity');
});

test('native slash-command echoes remove their optimistic copy with timestamp safeguards', () => {
  const item: Outgoing = { key: 'x', prompt: '/loop', started: at, state: 'confirmed' };
  const event = {
    sourceId: 'slash-echo',
    id: 'echo',
    sequence: 1,
    sessionId: 's',
    nativeSessionId: 'n',
    source: 'claude',
    kind: 'user.message',
    timestamp: at,
    data: { text: '<command-message>loop</command-message><command-name>/loop</command-name>' },
  } as Event;
  assert.equal(hasNativeEcho(item, [event]), true);
  assert.equal(hasNativeEcho({ ...item, prompt: '/help' }, [event]), false);
  assert.equal(hasNativeEcho(item, [{ ...event, timestamp: '2026-10-08T00:00:00Z' }]), false);
});
