import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { CodexGoals } from '../../adapters/src/codex-goals.ts';
import type { GoalSnapshot, Session } from '@harnessrc/protocol';
import { fixture } from './helpers.ts';

function nativeFixture() {
  let goal: GoalSnapshot['goal'] = null;
  let loaded = true,
    owner = true,
    wrongThread = false,
    lost = false;
  const calls: { method: string; params: any }[] = [];
  const s = { nativeSessionId: 'exact-thread' } as Session;
  const native = new CodexGoals(
    {
      request: async (method, params: any) => {
        assert.equal(params.threadId, s.nativeSessionId);
        calls.push({ method, params });
        if (method === 'thread/goal/get')
          return {
            goal: goal && { ...goal, ...(wrongThread ? { threadId: 'other-thread' } : {}) },
          };
        if (method === 'thread/read')
          return {
            thread: { id: s.nativeSessionId, status: { type: loaded ? 'active' : 'notLoaded' } },
          };
        if (method === 'thread/goal/set') {
          assert.equal(params.origin, 'user');
          goal = {
            threadId: s.nativeSessionId,
            objective: params.objective ?? goal!.objective,
            status: params.status,
            tokensUsed: 120,
            timeUsedSeconds: 65,
            tokenBudget: null,
            createdAt: 100,
            updatedAt: 101,
          };
          if (lost) throw new Error('Lost acknowledgement');
          return { goal };
        }
        if (method === 'thread/goal/clear') {
          assert.equal(params.origin, 'user');
          goal = null;
          return { cleared: true };
        }
        assert.fail(`Unexpected native method ${method}`);
      },
    },
    async () => {
      if (!owner) throw new Error('Replaced owner');
    },
  );
  return {
    native,
    s,
    calls,
    unload: () => {
      loaded = false;
    },
    replace: () => {
      owner = false;
    },
    mismatch: () => {
      wrongThread = true;
    },
    lose: () => {
      lost = true;
    },
  };
}

test('native goals preserve exact thread identity, user provenance, counters and lifecycle without a chat turn', async () => {
  const f = nativeFixture();
  assert.deepEqual(await f.native.read(f.s), { supported: true, goal: null });
  assert.equal(
    (await f.native.set(f.s, { objective: 'Fix tests\nand verify results' })).goal?.status,
    'active',
  );
  const paused = await f.native.set(f.s, { status: 'paused' });
  assert.equal(paused.goal?.objective, 'Fix tests\nand verify results');
  assert.equal(paused.goal?.tokensUsed, 120);
  assert.equal(paused.goal?.tokenBudget, null);
  assert.equal((await f.native.set(f.s, { status: 'active' })).goal?.status, 'active');
  assert.equal((await f.native.set(f.s, { clear: true })).goal, null);
  assert.ok(
    !f.calls.some((c) => ['thread/resume', 'thread/start', 'turn/start'].includes(c.method)),
  );
});

test('goals reject wrong native identities, unloaded threads and replaced owners; unsupported is distinct from outage', async () => {
  const f = nativeFixture();
  await assert.rejects(f.native.set(f.s, { status: 'active' }), /No goal/);
  await f.native.set(f.s, { objective: 'Verify' });
  f.unload();
  await assert.rejects(f.native.set(f.s, { objective: 'Different' }), /not loaded/);
  f.mismatch();
  await assert.rejects(f.native.read(f.s), /different thread/);
  f.replace();
  await assert.rejects(f.native.read(f.s), /Replaced owner/);
  for (const message of ['Method not found', 'Native socket disconnected']) {
    const goals = new CodexGoals(
      {
        request: async () => {
          throw new Error(message);
        },
      },
      async () => {},
    );
    if (message === 'Method not found') assert.equal((await goals.read(f.s)).supported, false);
    else await assert.rejects(goals.read(f.s), /disconnected/);
  }
});

test('goal commands work during native work, pause while blocked, isolate ownership and never enter chat or queue', async () => {
  const f = await fixture({ startRuntime: false });
  try {
    const { runtime, store, app } = f.gateway;
    const s = {
      ...f.session,
      harness: 'codex',
      ownership: 'observed' as const,
      nativeSessionId: 'exact-thread',
    };
    store.saveSession(s);
    const n = nativeFixture();
    let state = 'working';
    runtime.assertBinding = async () => {};
    runtime.adapters.set(s.id, {
      goal: () => n.native.read(s),
      setGoal: (_s, change) => n.native.set(s, change),
      turnState: async () => state,
    } as any);
    const command = (line: string, requestId = randomUUID(), generation = s.generation) =>
      app.inject({
        method: 'POST',
        url: `/api/sessions/${s.id}/commands`,
        headers: f.headers,
        payload: { line, requestId, generation },
      });
    assert.equal((await command('/goal')).json().action, 'tasks');
    const key = randomUUID();
    assert.equal(
      (await command('/goal Verify all tests\nKeep APIs compatible', key)).statusCode,
      200,
    );
    assert.equal(
      (await command('/goal Verify all tests\nKeep APIs compatible', key)).statusCode,
      200,
    );
    assert.equal(n.calls.filter((c) => c.method === 'thread/goal/set').length, 1);
    assert.notEqual((await command('/goal clear', randomUUID(), 'wrong-owner')).statusCode, 200);
    const detail = (await app.inject({ url: `/api/sessions/${s.id}`, headers: f.headers })).json();
    assert.ok(detail.commands.some((c: any) => c.name === 'goal'));
    const goalUrl = `/api/sessions/${s.id}/goal`;
    assert.notEqual((await app.inject({ url: goalUrl })).statusCode, 200);
    assert.equal(
      (await app.inject({ url: goalUrl, headers: f.headers })).json().goal.tokensUsed,
      120,
    );
    state = 'blocked';
    assert.equal((await command('/goal pause')).statusCode, 200);
    assert.notEqual((await command('/goal resume')).statusCode, 200);
    assert.equal(
      (await app.inject({ url: goalUrl, headers: f.headers })).json().goal.status,
      'paused',
    );
    state = 'idle';
    assert.equal((await command('/goal resume')).statusCode, 200);
    assert.equal((await command('/goal clear')).statusCode, 200);
    assert.notEqual((await command('/goal pause')).statusCode, 200);
    // Validation errors must not poison all subsequent commands.
    assert.equal((await command('/goal A new objective')).statusCode, 200);
    assert.deepEqual(f.mock.prompts, []);
    assert.deepEqual(store.tasks(s.id), []);
    store.saveSession({ ...s, harness: 'claude' });
    assert.ok(
      !(await app.inject({ url: `/api/sessions/${s.id}`, headers: f.headers }))
        .json()
        .commands.some((c: any) => c.name === 'goal'),
    );
  } finally {
    await f.close();
  }
});

test('an uncertain goal acknowledgement never repeats a native mutation or creates a follow-up', async () => {
  const f = await fixture({ startRuntime: false });
  try {
    const { runtime, store, app } = f.gateway;
    const s = { ...f.session, harness: 'codex', nativeSessionId: 'exact-thread' };
    store.saveSession(s);
    const n = nativeFixture();
    n.lose();
    runtime.assertBinding = async () => {};
    runtime.adapters.set(s.id, {
      goal: () => n.native.read(s),
      setGoal: (_s, change) => n.native.set(s, change),
      turnState: async () => 'idle',
    } as any);
    const payload = {
      line: '/goal Verify with evidence',
      requestId: randomUUID(),
      generation: s.generation,
    };
    for (let i = 0; i < 2; i++)
      assert.notEqual(
        (
          await app.inject({
            method: 'POST',
            url: `/api/sessions/${s.id}/commands`,
            headers: f.headers,
            payload,
          })
        ).statusCode,
        200,
      );
    assert.equal(n.calls.filter((c) => c.method === 'thread/goal/set').length, 1);
    assert.equal(
      (await app.inject({ url: `/api/sessions/${s.id}/goal`, headers: f.headers })).json().goal
        .objective,
      'Verify with evidence',
    );
    assert.deepEqual(store.tasks(s.id), []);
  } finally {
    await f.close();
  }
});

test('base settings commands use adapter APIs without interactive CLI menus and invalid choices do not block retry', async () => {
  const f = await fixture({ startRuntime: false });
  try {
    const { runtime, store, app } = f.gateway;
    const s = { ...f.session, harness: 'codex', ownership: 'observed' as const };
    store.saveSession(s);
    runtime.assertBinding = async () => {};
    const writes: unknown[] = [];
    runtime.adapters.set(s.id, {
      turnState: async () => 'working',
      models: async () => ({ groups: [{ id: 'provider', models: [{ id: 'next' }] }] }),
      setModel: async (_s: Session, choice: unknown) => {
        writes.push(choice);
      },
      permissions: async () => ({
        current: 'old',
        options: [{ value: 'workspace', name: 'Workspace' }],
      }),
      setPermissions: async (_s: Session, value: string, expected: string) => {
        writes.push({ value, expected });
      },
      mode: async () => ({
        supported: true,
        current: 'plan',
        options: [{ value: 'default' }, { value: 'plan' }],
      }),
      setMode: async (_s: Session, value: string) => {
        writes.push(value);
      },
    } as any);
    const command = (line: string) =>
      app.inject({
        method: 'POST',
        url: `/api/sessions/${s.id}/commands`,
        headers: f.headers,
        payload: { line, requestId: randomUUID(), generation: s.generation },
      });
    assert.equal((await command('/status')).json().action, 'details');
    assert.equal((await command('/approvals')).json().action, 'details');
    assert.notEqual((await command('/model unavailable')).statusCode, 200);
    for (const line of ['/model provider/next', '/permissions workspace', '/plan off'])
      assert.equal((await command(line)).statusCode, 200, line);
    assert.deepEqual(writes, [
      { provider: 'provider', model: 'next' },
      { value: 'workspace', expected: 'old' },
      'default',
    ]);
    assert.deepEqual(f.mock.prompts, []);
  } finally {
    await f.close();
  }
});
