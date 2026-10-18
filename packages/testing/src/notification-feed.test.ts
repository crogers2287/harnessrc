import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.ts';

test('notification feed baselines history, replays real events, filters stale questions and enforces grants', async () => {
  const f = await fixture({ startRuntime: false });
  try {
    const { store, app, auth, runtime } = f.gateway;
    const emit = (
      id: string,
      kind: any,
      data = {},
      timestamp = new Date().toISOString(),
      session = f.session,
    ) => store.event(session, { sourceId: id, kind, data, timestamp });
    emit('old', 'turn.completed');
    const get = async (query = '', headers = f.headers) =>
      (await app.inject({ url: '/api/notifications' + query, headers })).json();
    const baseline = await get();
    assert.deepEqual(baseline.items, []);
    const question = runtime.broker.open(f.session.id, {
      nativeRequestId: 'q1',
      expiresAt: new Date(Date.now() + 60000).toISOString(),
      type: 'confirmation',
      prompt: 'Proceed?',
      choices: [],
      responseSchema: { type: 'boolean' },
      route: 'mock',
    });
    emit('question', 'question', { interactionId: question.id });
    emit('done', 'turn.completed');
    emit('status', 'agent.status', { status: 'done' });
    emit('imported', 'turn.completed', {}, '2020-01-01T00:00:00Z');
    emit('orphan', 'question', { interactionId: 'missing' });
    const feed = await get(`?after=${baseline.cursor}`);
    assert.ok(feed.items.some((i: any) => i.kind === 'question'));
    assert.equal(feed.items.filter((i: any) => i.kind === 'completion').length, 1);
    assert.deepEqual((await get(`?after=${feed.cursor}`)).items, []);
    store.saveInteraction({ ...question, status: 'answered' });
    assert.ok(
      (await get(`?after=${baseline.cursor}`)).items.every((i: any) => i.kind !== 'question'),
    );
    const admin = auth.authenticate(f.headers.cookie.split('=')[1]);
    const tokens = auth.pair(auth.pairCode(admin), 'Notification reader');
    const reader = auth.authenticate(tokens.access);
    assert.deepEqual(
      (
        await get(`?after=${baseline.cursor}`, {
          ...f.headers,
          cookie: `rc_access=${tokens.access}`,
        })
      ).items,
      [],
    );
    auth.grant(admin, reader.id, f.session.id, false);
    assert.equal(
      (
        await get(`?after=${baseline.cursor}`, {
          ...f.headers,
          cookie: `rc_access=${tokens.access}`,
        })
      ).items.length,
      1,
    );
    store.db
      .prepare('INSERT INTO session_preferences(session_id,archived) VALUES(?,1)')
      .run(f.session.id);
    assert.deepEqual((await get(`?after=${baseline.cursor}`)).items, []);
    assert.equal((await app.inject({ url: '/api/notifications' })).statusCode, 401);
  } finally {
    await f.close();
  }
});

test('notification cursor paginates reconnect bursts without replaying status churn', async () => {
  const f = await fixture({ startRuntime: false });
  try {
    const { store, app } = f.gateway;
    for (let n = 0; n < 205; n++)
      store.event(f.session, {
        sourceId: `done-${n}`,
        kind: 'turn.completed',
        timestamp: new Date().toISOString(),
        data: {},
      });
    const first = (
      await app.inject({ url: '/api/notifications?after=0', headers: f.headers })
    ).json();
    assert.equal(first.items.length, 200);
    assert.equal(first.more, true);
    const next = (
      await app.inject({ url: `/api/notifications?after=${first.cursor}`, headers: f.headers })
    ).json();
    assert.equal(next.items.length, 5);
    assert.equal(next.more, false);
    assert.equal(new Set([...first.items, ...next.items].map((i) => i.id)).size, 205);
  } finally {
    await f.close();
  }
});
