import test from 'node:test';
import assert from 'node:assert/strict';
import { pruneCandidates } from '../../../apps/gateway/src/prune.ts';
import type { Session } from '@harnessrc/protocol';

test('a week of inactivity retires a pane, sparing pinned, busy, and recently used sessions', () => {
  const now = Date.parse('2026-10-19T12:00:00Z');
  const old = '2026-10-10T12:00:00Z';
  const s = (id: string, paneId: string, extra: Partial<Session> = {}) =>
    ({
      id,
      hostId: 'fred',
      paneId,
      status: 'idle',
      connected: true,
      lastActivity: old,
      ...extra,
    }) as Session;
  const sessions = [
    s('stale', 'w1:p1'),
    s('ended-before', 'w1:p1', { status: 'ended', connected: false }),
    s('restarted', 'w1:p2', { status: 'ended', connected: false }),
    s('fresh', 'w1:p2', { lastActivity: '2026-10-18T12:00:00Z' }),
    s('pinned', 'w1:p3'),
    s('working', 'w1:p4', { status: 'working' }),
    s('gone', 'w1:p5', { status: 'ended', connected: false }),
  ];
  const r = pruneCandidates(sessions, new Set(['pinned']), now);
  assert.deepEqual(r.close, [{ hostId: 'fred', paneId: 'w1:p1' }]);
  assert.deepEqual(r.archive, ['stale', 'ended-before', 'restarted', 'gone']);
});
