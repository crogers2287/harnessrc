import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Store } from '@harnessrc/storage';
import { HelperConversations, helperConnectionSchema } from '../../../apps/gateway/src/helper.ts';
const connection = helperConnectionSchema.parse({
  id: 'my-proxy',
  label: 'My proxy',
  baseUrl: 'https://proxy.invalid/v1',
  models: [{ id: 'chosen-model', name: 'Chosen model' }],
});
const input = () => ({
  requestId: randomUUID(),
  profileId: connection.id,
  model: 'chosen-model',
  prompt: 'List my sessions',
});
async function settle(helper: HelperConversations, device = 'phone') {
  for (let i = 0; i < 100; i++) {
    const view = await helper.view(device);
    if (view.current?.status !== 'running') return view;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error('Helper did not settle');
}
test('app helper has private history, exact idempotency and no ordinary session or harness launch', async () => {
  const store = new Store(':memory:');
  const calls: any[] = [];
  let toolCalls = 0;
  const fetcher = async (url: string, init?: RequestInit) => {
    if (String(url).endsWith('/models')) return Response.json({ data: [{ id: 'chosen-model' }] });
    const body = JSON.parse(init!.body as string);
    calls.push(body);
    return Response.json({
      choices: [
        {
          message:
            calls.length === 1
              ? {
                  role: 'assistant',
                  content: null,
                  tool_calls: [
                    {
                      id: 'tool1',
                      type: 'function',
                      function: { name: 'relay_sessions', arguments: '{}' },
                    },
                  ],
                }
              : { role: 'assistant', content: 'One session is ready.' },
        },
      ],
      usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 },
    });
  };
  const helper = new HelperConversations(store, [connection], fetcher);
  const tools = async () => ({
    list: [{ name: 'relay_sessions', inputSchema: { type: 'object' } }],
    call: async () => {
      toolCalls++;
      return { sessions: [] };
    },
    close: async () => {},
  });
  try {
    const body = input();
    const [first, replay] = await Promise.all([
      helper.start(body, 'phone', tools),
      helper.start(body, 'phone', tools),
    ]);
    assert.equal(first.conversationId, replay.conversationId);
    let view = await settle(helper);
    assert.equal(view.current?.messages.length, 2);
    assert.equal(view.current?.status, 'idle');
    assert.equal(view.current?.usage?.total, 30);
    assert.equal(toolCalls, 1);
    assert.equal(calls[1].messages.at(-1).role, 'tool');
    assert.equal(calls[0].model, 'chosen-model');
    assert.equal(store.sessions().length, 0);
    assert.equal((await helper.view('other-device')).current, null);
    await assert.rejects(
      () => helper.start({ ...body, prompt: 'changed' }, 'phone', tools),
      /different settings/,
    );
    await assert.rejects(() => helper.start(body, 'other-device', tools), /different settings/);
    const follow = {
      requestId: randomUUID(),
      conversationId: first.conversationId,
      prompt: 'Thank you',
    };
    await helper.message(follow, 'phone', tools);
    await helper.message(follow, 'phone', tools);
    view = await settle(helper);
    assert.equal(view.current?.messages.length, 4);
    assert.equal(calls.length, 3);
    const reopened = new HelperConversations(store, [connection], fetcher);
    assert.equal((await reopened.view('phone')).current?.id, first.conversationId);
    await reopened.start(body, 'phone', tools);
    assert.equal(calls.length, 3);
    await assert.rejects(
      () => helper.start({ ...input(), model: 'missing' }, 'phone', tools),
      /available proxy model/,
    );
  } finally {
    helper.close();
    store.close();
  }
});
test('helper stop aborts only its own request and restart never repeats tool mutations', async () => {
  const store = new Store(':memory:');
  const fetcher = async (url: string, init?: RequestInit) => {
    if (String(url).endsWith('/models')) return Response.json({ data: [{ id: 'chosen-model' }] });
    return new Promise<Response>((_resolve, reject) =>
      init!.signal!.addEventListener('abort', () => reject(new Error('aborted')), { once: true }),
    );
  };
  const helper = new HelperConversations(store, [connection], fetcher);
  const tools = async () => ({ list: [], call: async () => null, close: async () => {} });
  try {
    await helper.start(input(), 'phone', tools);
    await new Promise((r) => setTimeout(r, 5));
    helper.stop('other');
    assert.equal((await helper.view('phone')).current?.status, 'running');
    helper.stop('phone');
    assert.equal((await settle(helper)).current?.status, 'stopped');
    assert.equal(store.sessions().length, 0);
    const row = store.db.prepare('SELECT body FROM helper_chats').get()!;
    const chat = JSON.parse(row.body as string);
    chat.status = 'running';
    store.db.prepare('UPDATE helper_chats SET body=?').run(JSON.stringify(chat));
    const restarted = new HelperConversations(store, [connection], fetcher);
    assert.equal((await restarted.view('phone')).current?.status, 'stopped');
  } finally {
    helper.close();
    store.close();
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

test('private helper tools use the initiating device authorization through Relay API and leave session list unchanged', async () => {
  const { createServer } = await import('node:http');
  const { fixture, eventually } = await import('./helpers.ts');
  let proxyCalls = 0;
  let observedToolResult = '';
  const proxy = createServer(async (req, res) => {
    if (req.url === '/v1/models') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ data: [{ id: 'chosen-model' }] }));
      return;
    }
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    proxyCalls++;
    assert.ok(body.tools.some((t: any) => t.function.name === 'relay_sessions'));
    const message =
      proxyCalls === 1
        ? {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'list1',
                type: 'function',
                function: { name: 'relay_sessions', arguments: '{}' },
              },
            ],
          }
        : { role: 'assistant', content: 'Sessions inspected.' };
    if (proxyCalls === 2) observedToolResult = body.messages.at(-1).content;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message }] }));
  });
  await new Promise<void>((r) => proxy.listen(0, '127.0.0.1', r));
  const address = proxy.address() as { port: number };
  const f = await fixture({
    startRuntime: false,
    helperConnections: [{ ...connection, baseUrl: `http://127.0.0.1:${address.port}/v1` }],
  });
  try {
    const initial = (await f.gateway.app.inject({ url: '/api/sessions', headers: f.headers }))
      .json()
      .sessions.map((s: any) => s.id);
    const body = input();
    assert.equal(
      (
        await f.gateway.app.inject({
          url: '/api/helper',
          method: 'POST',
          headers: f.headers,
          payload: body,
        })
      ).statusCode,
      200,
    );
    await eventually(
      async () =>
        (await f.gateway.app.inject({ url: '/api/helper', headers: f.headers })).json().current
          ?.status === 'idle',
    );
    assert.equal(proxyCalls, 2);
    assert.ok(JSON.parse(observedToolResult).content[0].text.includes(f.session.id));
    assert.deepEqual(
      (await f.gateway.app.inject({ url: '/api/sessions', headers: f.headers }))
        .json()
        .sessions.map((s: any) => s.id),
      initial,
    );
    assert.equal(
      (await f.gateway.app.inject({ url: '/api/helper', headers: f.headers }))
        .json()
        .current.messages.at(-1).content,
      'Sessions inspected.',
    );
    assert.equal(
      Number(f.gateway.store.db.prepare('SELECT count(*) AS n FROM tokens').get()!.n),
      2,
      'temporary tool tokens are deleted',
    );
    await f.gateway.app.inject({
      url: '/api/helper',
      method: 'POST',
      headers: f.headers,
      payload: body,
    });
    assert.equal(proxyCalls, 2);
  } finally {
    await f.close();
    await new Promise<void>((resolve, reject) => proxy.close((e) => (e ? reject(e) : resolve())));
  }
});
test('helper proxy handles streamed text and fragmented tool arguments and detects disconnection', async () => {
  const { helperCompletion } = await import('../../../apps/gateway/src/helper-proxy.ts');
  const frames = [
    { choices: [{ delta: { role: 'assistant', content: 'Hello ' } }] },
    {
      choices: [
        {
          delta: {
            content: 'there',
            tool_calls: [
              { index: 0, id: 'call1', function: { name: 'relay_sessions', arguments: '{' } },
            ],
          },
        },
      ],
    },
    {
      choices: [
        {
          delta: { tool_calls: [{ index: 0, function: { arguments: '}' } }] },
          finish_reason: 'tool_calls',
        },
      ],
      usage: { total_tokens: 20 },
    },
  ];
  const wire =
    frames.map((f) => 'data: ' + JSON.stringify(f) + '\n\n').join('') + 'data: [DONE]\n\n';
  const chunks: string[] = [];
  const response = new Response(
    new ReadableStream({
      start(c) {
        for (let i = 0; i < wire.length; i += 17)
          c.enqueue(new TextEncoder().encode(wire.slice(i, i + 17)));
        c.close();
      },
    }),
    { headers: { 'content-type': 'text/event-stream' } },
  );
  const result = await helperCompletion(response, (t) => chunks.push(t));
  assert.equal(result.choices[0].message.content, 'Hello there');
  assert.equal(result.choices[0].message.tool_calls[0].function.arguments, '{}');
  assert.equal(result.usage.total_tokens, 20);
  assert.deepEqual(chunks, ['Hello ', 'Hello there']);
  await assert.rejects(
    () =>
      helperCompletion(
        new Response('data: ' + JSON.stringify(frames[0]) + '\n\n', {
          headers: { 'content-type': 'text/event-stream' },
        }),
        () => {},
      ),
    /disconnected/,
  );
});

test('legacy migration hides only the exact app-created helper and preserves its session and transcript', async () => {
  const { fixture } = await import('./helpers.ts');
  const f = await fixture({ startRuntime: false });
  try {
    const { store, app } = f.gateway;
    const requestId = randomUUID();
    store.db.exec(
      'CREATE TABLE helper_bindings(device_id TEXT PRIMARY KEY,request_id TEXT UNIQUE NOT NULL,body TEXT NOT NULL)',
    );
    store.db
      .prepare('INSERT INTO helper_bindings VALUES(?,?,?)')
      .run('legacy-device', requestId, '{}');
    store.db.prepare('INSERT INTO launches VALUES(?,?,?,?)').run(
      requestId,
      '{}',
      JSON.stringify({
        requestId,
        status: 'started',
        hostId: f.session.hostId,
        nativeSessionId: f.session.nativeSessionId,
      }),
      new Date().toISOString(),
    );
    store.saveSession({ ...f.session, ownership: 'herdr-cli' });
    const helper = new HelperConversations(store, []);
    assert.ok(helper.legacySessionIds().has(f.session.id));
    const list = (await app.inject({ url: '/api/sessions', headers: f.headers })).json().sessions;
    assert.ok(!list.some((s: any) => s.id === f.session.id));
    assert.ok(store.session(f.session.id));
    assert.equal(
      (await app.inject({ url: `/api/sessions/${f.session.id}`, headers: f.headers })).statusCode,
      200,
    );
    store.db
      .prepare('UPDATE launches SET receipt=? WHERE id=?')
      .run(
        JSON.stringify({ hostId: 'different-host', nativeSessionId: f.session.nativeSessionId }),
        requestId,
      );
    assert.equal(helper.legacySessionIds().size, 0);
  } finally {
    await f.close();
  }
});
