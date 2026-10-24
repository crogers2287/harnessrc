import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Store } from '@harnessrc/storage';
import { HerdrClient } from '@harnessrc/herdr';
import { Launcher, launchProfileSchema } from '../../../apps/gateway/src/launch.ts';
import { HelperConversations, HELPER_INSTRUCTIONS } from '../../../apps/gateway/src/helper.ts';

function setup() {
  const store = new Store(':memory:');
  const client = new HerdrClient('portable-host', '/unused');
  client.host.connected = true;
  const calls: { method: string; params: any }[] = [];
  let name = '';
  client.request = async (method, params: any) => {
    calls.push({ method, params });
    if (method === 'agent.start') name = params.name;
    if (method === 'agent.get')
      return {
        agent: { terminal_id: 'helper-terminal', agent: 'codex', name, interactive_ready: true },
      };
    return { root_pane: { pane_id: 'w1:p4', terminal_id: 'helper-terminal' } };
  };
  const profile = launchProfileSchema.parse({
    id: 'my-proxy',
    hostId: 'portable-host',
    label: 'My proxy',
    harness: 'codex',
    provider: 'Custom CFR connection',
    helper: true,
    modelsEndpoint: 'https://proxy.invalid/v1/models',
    models: [{ id: 'chosen-model', name: 'Chosen model' }],
    workspaceId: 'w1',
    roots: ['/tmp'],
  });
  const launcher = new Launcher(
    store,
    [
      profile,
      { ...profile, id: 'ordinary', helper: false },
      { ...profile, id: 'no-proxy', modelsEndpoint: undefined },
    ],
    new Map([['portable-host', client]]),
  );
  launcher.models = async (p) => p.models;
  return { store, launcher, calls, helper: new HelperConversations(store, launcher) };
}

test('helper uses configured proxy model, native owner, separate role, and durable request receipts', async () => {
  const f = setup();
  try {
    assert.deepEqual(
      (await f.helper.view('phone')).profiles.map((p) => p.id),
      ['my-proxy'],
    );
    const input = {
      requestId: randomUUID(),
      profileId: 'my-proxy',
      model: 'chosen-model',
      prompt: 'List my sessions',
    };
    const [first, replay] = await Promise.all([
      f.helper.start(input, 'phone'),
      f.helper.start(input, 'phone'),
    ]);
    assert.equal(first.status, 'started');
    assert.equal(replay.requestId, input.requestId);
    assert.equal(f.calls.filter((c) => c.method === 'agent.start').length, 1);
    const args = f.calls.find((c) => c.method === 'agent.start')!.params.args;
    assert.deepEqual(args, [
      '-c',
      `developer_instructions=${JSON.stringify(HELPER_INSTRUCTIONS)}`,
      '--model',
      'chosen-model',
    ]);
    assert.equal((await f.helper.view('phone')).current?.model, 'chosen-model');
    assert.equal((await f.helper.view('other-device')).current, null);
    const reopened = new HelperConversations(f.store, f.launcher);
    await reopened.start(input, 'phone');
    assert.equal(f.calls.filter((c) => c.method === 'agent.start').length, 1);
    await assert.rejects(
      () => f.helper.start({ ...input, model: 'missing' }, 'phone'),
      /available proxy model/,
    );
    await assert.rejects(
      () => f.helper.start({ ...input, prompt: 'Changed' }, 'phone'),
      /different settings/,
    );
    await assert.rejects(
      () => f.helper.start({ ...input, requestId: randomUUID() }, 'phone'),
      /already exists/,
    );
    await assert.rejects(
      () => f.helper.start({ ...input, profileId: 'ordinary' }, 'phone'),
      /enabled helper/,
    );
    await assert.rejects(
      () => f.helper.start({ ...input, profileId: 'no-proxy' }, 'phone'),
      /enabled helper/,
    );
  } finally {
    f.store.close();
  }
});

test('helper restores previous binding on definite prelaunch failure and retains uncertain native launches', async () => {
  const f = setup();
  try {
    const input = {
      requestId: randomUUID(),
      profileId: 'my-proxy',
      model: 'chosen-model',
      prompt: 'Inspect health',
    };
    await f.helper.start(input, 'phone');
    const original = f.launcher.launch.bind(f.launcher);
    f.launcher.launch = async () => {
      throw new Error('Host disconnected');
    };
    await assert.rejects(
      () => f.helper.start({ ...input, requestId: randomUUID(), replace: true }, 'phone'),
      /Host disconnected/,
    );
    assert.equal((await f.helper.view('phone')).current?.requestId, input.requestId);
    f.launcher.launch = original;
    const requestId = randomUUID();
    const receipt = {
      requestId,
      status: 'uncertain',
      hostId: 'portable-host',
      diagnostic: 'Check native owner',
    };
    f.store.db
      .prepare('INSERT INTO launches VALUES(?,?,?,?)')
      .run(requestId, '{}', JSON.stringify(receipt), new Date().toISOString());
    f.launcher.launch = async () => receipt as any;
    await f.helper.start({ ...input, requestId, replace: true }, 'phone');
    assert.equal((await f.helper.view('phone')).current?.receipt.status, 'uncertain');
  } finally {
    f.store.close();
  }
});

test('helper attention emits one durable reminder per unanswered question and filters resolved, stale and archived sessions', async () => {
  const { fixture } = await import('./helpers.ts');
  const { HelperAttention } = await import('../../../apps/gateway/src/helper-attention.ts');
  const f = await fixture({ startRuntime: false });
  try {
    const { store, runtime, app } = f.gateway;
    const now = Date.now();
    const attention = new HelperAttention(store, true, 5);
    const question = runtime.broker.open(f.session.id, {
      nativeRequestId: 'waiting',
      type: 'confirmation',
      prompt: 'Choose the next action?',
      choices: [],
      responseSchema: { type: 'boolean' },
      route: 'mock',
      expiresAt: new Date(now + 3600000).toISOString(),
    });
    const baseline = Number(store.db.prepare('SELECT MAX(sequence) AS n FROM events').get()!.n);
    assert.equal(attention.pending(now)[0].waitingMinutes, 0);
    attention.tick(now + 4 * 60000);
    assert.equal(
      Number(store.db.prepare('SELECT MAX(sequence) AS n FROM events').get()!.n),
      baseline,
    );
    attention.tick(now + 6 * 60000);
    attention.tick(now + 7 * 60000);
    const alerts = store.db
      .prepare("SELECT body FROM events WHERE json_extract(body,'$.data.helperAlert')=1")
      .all();
    assert.equal(alerts.length, 1);
    const feed = (
      await app.inject({ url: `/api/notifications?after=${baseline}`, headers: f.headers })
    ).json();
    assert.equal(feed.items[0].title, 'Session waiting for your answer');
    assert.equal(feed.items[0].interactionId, question.id);
    assert.match(feed.items[0].body, /has waited [56] minutes/);
    store.saveInteraction({ ...question, status: 'answered' });
    assert.deepEqual(attention.pending(), []);
    assert.deepEqual(
      (await app.inject({ url: `/api/notifications?after=${baseline}`, headers: f.headers })).json()
        .items,
      [],
    );
    store.saveInteraction({ ...question, generation: 'old-owner' });
    assert.deepEqual(attention.pending(), []);
    store.saveInteraction(question);
    store.db
      .prepare('INSERT INTO session_preferences(session_id,archived) VALUES(?,1)')
      .run(f.session.id);
    assert.deepEqual(attention.pending(), []);
  } finally {
    await f.close();
  }
});

test('helper notification API checks generation, auth, idempotency and publishes to the existing push feed', async () => {
  const { fixture } = await import('./helpers.ts');
  const f = await fixture({ startRuntime: false });
  try {
    const { app, store } = f.gateway;
    const url = `/api/sessions/${f.session.id}/helper-notices`;
    const payload = {
      requestId: randomUUID(),
      title: 'Relay helper',
      body: 'A session needs your review. Open Relay.',
    };
    assert.equal(
      (await app.inject({ url, method: 'POST', headers: f.headers, payload })).statusCode,
      409,
    );
    const headers = { ...f.headers, 'x-rc-generation': f.session.generation };
    const first = await app.inject({ url, method: 'POST', headers, payload });
    assert.equal(first.statusCode, 200);
    assert.deepEqual(
      (await app.inject({ url, method: 'POST', headers, payload })).json(),
      first.json(),
    );
    assert.equal(
      (await app.inject({ url, method: 'POST', headers, payload: { ...payload, body: 'Changed' } }))
        .statusCode,
      409,
    );
    assert.equal(
      store.db
        .prepare("SELECT COUNT(*) AS n FROM events WHERE json_extract(body,'$.data.helperAlert')=1")
        .get()!.n,
      1,
    );
    const feed = (
      await app.inject({ url: '/api/notifications?after=0', headers: f.headers })
    ).json();
    assert.ok(feed.items.some((i: any) => i.kind === 'helper' && i.body === payload.body));
  } finally {
    await f.close();
  }
});
