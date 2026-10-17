import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fixture } from './helpers.ts';

test('slash commands use native delivery, respect state and ownership, and never enter chat or queue', async () => {
  const f = await fixture({ startRuntime: false });
  const { runtime, store, app } = f.gateway;
  const s = { ...f.session, harness: 'claude', ownership: 'herdr-cli' as const };
  store.saveSession(s);
  let state = 'idle',
    interrupted = 0,
    nativeCalls = 0,
    fail = false;
  runtime.assertBinding = async (session) => {
    assert.equal(session.generation, s.generation);
  };
  runtime.adapters.set(s.id, {
    turnState: async () => state,
    interrupt: async () => {
      interrupted++;
    },
    send: async () => assert.fail('command entered chat'),
    steer: async () => assert.fail('command entered steering'),
  } as any);
  const client = runtime.clients.get(s.hostId)!;
  client.request = (async (method: string, args: any) => {
    assert.equal(method, 'agent.prompt');
    assert.equal(args.text, '/compact');
    nativeCalls++;
    if (fail) throw new Error('lost acknowledgement');
    return { agent: { terminal_id: s.terminalId, agent_session: { value: s.nativeSessionId } } };
  }) as any;
  const command = (line: string, requestId = randomUUID(), generation = s.generation) =>
    app.inject({
      method: 'POST',
      url: `/api/sessions/${s.id}/commands`,
      headers: f.headers,
      payload: { line, requestId, generation },
    });
  try {
    const key = randomUUID();
    assert.equal((await command('/compact', key)).statusCode, 200);
    assert.equal((await command('/compact', key)).statusCode, 200);
    assert.equal(nativeCalls, 1);
    assert.equal((await command('/stop', key)).statusCode, 409);
    assert.notEqual((await command('/compact', randomUUID(), 'stale-owner')).statusCode, 200);
    assert.equal((await command('/model')).json().action, 'details');
    state = 'blocked';
    assert.notEqual((await command('/compact')).statusCode, 200);
    assert.equal((await command('/stop')).statusCode, 200);
    assert.equal(interrupted, 1);
    state = 'idle';
    assert.notEqual((await command('/compact\n/bin/echo unsafe')).statusCode, 200);
    fail = true;
    const uncertain = randomUUID();
    assert.notEqual((await command('/compact', uncertain)).statusCode, 200);
    assert.notEqual((await command('/compact', uncertain)).statusCode, 200);
    assert.notEqual((await command('/compact')).statusCode, 200);
    assert.equal(nativeCalls, 2);
    assert.notEqual(
      (
        await app.inject({
          method: 'POST',
          url: `/api/sessions/${s.id}/tasks`,
          headers: f.headers,
          payload: { prompt: '/compact', idempotencyKey: randomUUID(), attachments: [] },
        })
      ).statusCode,
      200,
    );
    store.saveSession({
      ...s,
      capabilities: { ...s.capabilities, sendMessage: false, steerActiveTurn: false },
    });
    assert.notEqual((await command('/stop')).statusCode, 200);
    assert.equal(interrupted, 1);
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: `/api/sessions/${s.id}/commands`,
          payload: { line: '/stop', requestId: randomUUID(), generation: s.generation },
        })
      ).statusCode,
      403,
    );
  } finally {
    await f.close();
  }
});

test('legacy message clients route slash commands into controls instead of model prompts', async () => {
  const f = await fixture({ startRuntime: false });
  try {
    const r = await f.gateway.app.inject({
      method: 'POST',
      url: `/api/sessions/${f.session.id}/messages`,
      headers: f.headers,
      payload: { prompt: '/permissions', idempotencyKey: randomUUID(), attachments: [] },
    });
    assert.equal(r.statusCode, 200);
    assert.equal(r.json().mode, 'command');
    assert.equal(r.json().action, 'details');
    assert.deepEqual(f.mock.prompts, []);
  } finally {
    await f.close();
  }
});

test('DSH slash commands use its registered command executor, not session prompt', async () => {
  const f = await fixture({ startRuntime: false });
  try {
    const s = { ...f.session, harness: 'dsh', ownership: 'observed' as const };
    f.gateway.store.saveSession(s);
    f.gateway.runtime.assertBinding = async () => {};
    f.gateway.runtime.adapters.set(s.id, { turnState: async () => 'idle' } as any);
    const calls: unknown[] = [];
    f.gateway.runtime.dshHosts.set(s.hostId, {
      native: {
        call: async (method: string, args: unknown) => {
          calls.push({ method, args });
          return { result: { kind: 'success', text: 'Compacted' } };
        },
      },
    } as any);
    const result = await f.gateway.app.inject({
      method: 'POST',
      url: `/api/sessions/${s.id}/commands`,
      headers: f.headers,
      payload: { line: '/compact', generation: s.generation, requestId: randomUUID() },
    });
    assert.equal(result.statusCode, 200);
    assert.equal(result.json().message, 'Compacted');
    assert.deepEqual(calls, [
      {
        method: 'commands/execute',
        args: { agentId: s.nativeSessionId, line: '/compact', submittedAttachments: [] },
      },
    ]);
    f.gateway.runtime.dshHosts.delete(s.hostId);
  } finally {
    await f.close();
  }
});

test('plan mode and Escape use native settings and the verified CLI key channel', async () => {
  const f = await fixture({ startRuntime: false });
  try {
    const s = { ...f.session, ownership: 'herdr-cli' as const };
    f.gateway.store.saveSession(s);
    f.gateway.runtime.assertBinding = async () => {};
    let plans = 0,
      keys = 0;
    f.gateway.runtime.adapters.set(s.id, {
      turnState: async () => 'idle',
      interrupt: async () => assert.fail('Escape used generic interrupt'),
      mode: async () => ({
        supported: true,
        current: 'default',
        options: [{ value: 'plan', name: 'Plan' }],
      }),
      setMode: async (_s: unknown, value: string, expected: string) => {
        assert.equal(value, 'plan');
        assert.equal(expected, 'default');
        plans++;
      },
    } as any);
    f.gateway.runtime.clients.get(s.hostId)!.request = (async (method: string, args: unknown) => {
      assert.equal(method, 'agent.send_keys');
      assert.deepEqual(args, { target: s.paneId, keys: ['esc'] });
      keys++;
      return {};
    }) as any;
    for (const line of ['/plan', '/esc']) {
      const result = await f.gateway.app.inject({
        method: 'POST',
        url: `/api/sessions/${s.id}/commands`,
        headers: f.headers,
        payload: { line, generation: s.generation, requestId: randomUUID() },
      });
      assert.equal(result.statusCode, 200, result.body);
    }
    assert.equal(plans, 1);
    assert.equal(keys, 1);
    assert.deepEqual(f.mock.prompts, []);
  } finally {
    await f.close();
  }
});
