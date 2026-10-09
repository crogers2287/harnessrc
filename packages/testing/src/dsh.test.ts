import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { DshClient } from '../../adapters/src/dsh.ts';

test('DSH native transport preserves steering, request identity, exact model and auth', async () => {
  const requests: any[] = [];
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const part of req) body += part;
    const value = JSON.parse(body);
    requests.push(value);
    assert.equal(req.headers.cookie, 'test_session=fixture');
    assert.equal(req.url, `/api/${value.method}`);
    res.setHeader('content-type', 'application/json');
    res.end(
      JSON.stringify({
        type: 'server-response',
        rpcId: value.rpcId,
        result: { ok: true, value: { accepted: true } },
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = (server.address() as { port: number }).port;
    const client = new DshClient(`http://127.0.0.1:${port}`, async () => 'test_session=fixture');
    await client.prompt('native-session', 'durable-id', 'Update this turn', 'steer');
    await client.selectModel('native-session', 'cfrproxy', 'gpt-6-astra');
    assert.equal(requests[0].payload.args.request.mode, 'steer');
    assert.equal(requests[0].payload.args.request.requestId, 'durable-id');
    assert.equal(requests[1].payload.args.request.model, 'gpt-6-astra');
    assert.throws(() => client.prompt('native-session', '', 'hello', 'steer'), /incomplete/);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('DSH transport rejects unsafe endpoint and missing credentials before dispatch', async () => {
  assert.throws(() => new DshClient('http://remote.invalid', async () => 'cookie'), /HTTPS/);
  const client = new DshClient('http://127.0.0.1:1', async () => '');
  await assert.rejects(client.list(), /authentication/);
});

test('DSH discovery, paginated history, native model selection, steering and reconnect keep one session', async () => {
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { Store } = await import('@harnessrc/storage');
  const { DshHost } = await import('../../../apps/gateway/src/dsh-host.ts');
  const { Runtime } = await import('../../../apps/gateway/src/runtime.ts');
  const { configSchema } = await import('../../../apps/gateway/src/config.ts');
  const { WebSocketServer } = await import('ws');
  const { eventually } = await import('./helpers.ts');
  const directory = await mkdtemp(join(tmpdir(), 'dsh-fixture-'));
  const tokenFile = join(directory, 'token');
  await writeFile(tokenFile, 't'.repeat(43), { mode: 0o600 });
  let model = 'model-a',
    running = false,
    missing = false;
  const received: any[] = [];
  let permission = 'workspace-write';
  const now = Date.now();
  const records = [
    {
      seq: 0,
      time: now,
      type: 'user/message',
      data: { content: [{ type: 'text', text: 'Hello' }], source: { rpcId: 'task-one' } },
    },
    {
      seq: 1,
      time: now + 1,
      type: 'assistant/message',
      data: {
        turn: 1,
        step: 0,
        message: { content: [{ type: 'text', text: 'World' }], source: { model: 'model-a' } },
      },
    },
    { seq: 2, time: now + 2, type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
  ];
  const server = createServer(async (req, res) => {
    if (req.method === 'GET') {
      res.writeHead(302, { 'set-cookie': 'dsh-auth-test=fixture; HttpOnly', location: '/' });
      res.end();
      return;
    }
    assert.equal(req.headers.cookie, 'dsh-auth-test=fixture');
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    received.push(body);
    const request = body.payload.args.request;
    let value: any = {};
    switch (body.method) {
      case 'session/list':
        value = {
          items: missing
            ? []
            : [
                {
                  sessionId: 'native-one',
                  updatedAt: now,
                  running,
                  agentAvailable: true,
                  cwd: '/workspace/app',
                  projections: {
                    asOfSeq: 2,
                    values: {
                      title: 'Native DSH',
                      agentPreset: 'haxor',
                      permissions: { currentValue: permission },
                      modelSelection: { next: { provider: 'cfrproxy', model } },
                    },
                  },
                },
              ],
        };
        break;
      case 'permissionPresets/catalog':
        value = {
          options: ['read-only', 'workspace-write', 'danger-full-access'].map((value) => ({
            value,
            name: value,
          })),
        };
        break;
      case 'commands/execute':
        assert.equal(body.payload.args.agentId, 'native-one');
        assert.deepEqual(body.payload.args.submittedAttachments, []);
        permission = body.payload.args.line.replace('/permission ', '');
        value = { result: { kind: 'success' } };
        break;
      case 'session/modelCatalog':
        value = {
          groups: [
            {
              id: 'cfrproxy',
              name: 'CFRproxy',
              models: [
                { id: 'model-a', name: 'A' },
                { id: 'model-b', name: 'B' },
              ],
            },
          ],
        };
        break;
      case 'session/selectModel':
        model = request.model;
        value = { selected: { provider: request.provider, model } };
        break;
      case 'session/projections':
        value = { asOfSeq: 2 };
        break;
      case 'session/page':
        value =
          request.beforeSeq === undefined
            ? {
                records: records.slice(1).map((event) => ({ type: 'event', event })),
                hasMore: true,
              }
            : { records: [{ type: 'event', event: records[0] }], hasMore: false };
        break;
      case 'session/prompt':
        value = { accepted: true };
        break;
    }
    res.setHeader('content-type', 'application/json');
    res.end(
      JSON.stringify({ type: 'server-response', rpcId: body.rpcId, result: { ok: true, value } }),
    );
  });
  const ws = new WebSocketServer({ server, path: '/api/remote.mux' });
  ws.on('connection', (socket) =>
    socket.on('message', (raw) => {
      if (JSON.parse(raw.toString()).endpoint === '$events') {
        socket.send(
          JSON.stringify({
            type: 'item',
            streamId: 'questions',
            value: { type: 'ready', clientId: 'fixture' },
          }),
        );
        return;
      }
      socket.send(
        JSON.stringify({
          type: 'item',
          streamId: 'conversation',
          value: {
            type: 'snapshot',
            records: [],
            assistantStream: {
              activeAttempt: {
                attemptId: 'attempt-a',
                turn: 2,
                step: 0,
                stream: [
                  { type: 'reasoning-chunks', texts: ['private', 'reasoning'] },
                  { type: 'text-chunks', time0: now, index: 0, dt: [], texts: ['Live text'] },
                ],
              },
            },
          },
        }),
      );
    }),
  );
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const endpoint = `http://127.0.0.1:${(server.address() as any).port}`;
  const store = new Store(':memory:');
  const runtime = new Runtime(
    store,
    configSchema.parse({
      dataDir: directory,
      hosts: [{ id: 'unused', name: 'Unused', socket: '/unused' }],
    }),
  );
  let host = new DshHost({ id: 'dsh-host', name: 'Fred DSH', endpoint, tokenFile }, store);
  try {
    await host.refresh();
    const session = store.sessions()[0];
    assert.equal(session.sessionName, 'Native DSH');
    assert.equal(session.agentPreset, 'haxor');
    assert.equal(session.cwd, '/workspace/app');
    assert.equal(session.capabilities.steerActiveTurn, true);
    assert.equal(session.capabilities.answerQuestion, true);
    const adapter = host.adapters.get(session.id)!;
    assert.equal((await adapter.permissions(session)).current, 'workspace-write');
    assert.equal(
      (await adapter.setPermissions(session, 'read-only', 'workspace-write')).current,
      'read-only',
    );
    await assert.rejects(
      adapter.setPermissions(session, 'danger-full-access', 'workspace-write'),
      /changed/,
    );
    await assert.rejects(
      adapter.setPermissions(session, 'read-only; arbitrary', 'read-only'),
      /not available/,
    );
    assert.equal(received.filter((r) => r.method === 'commands/execute').length, 1);
    // Simulate launch discovery before the scheduler has adopted the adapter.
    runtime.dshHosts.set('dsh-host', host);
    assert.equal(runtime.adapters.has(session.id), false);
    await runtime.prepareConversation(session.id);
    assert.equal(runtime.adapters.get(session.id), adapter);
    const history = store.events(session.id);
    assert.deepEqual(
      history.map((e) => e.kind),
      ['user.message', 'assistant.message', 'turn.completed'],
    );
    for (const e of history) store.event(session, e);
    await eventually(() =>
      store.events(session.id).some((e) => e.sourceId === 'dsh-live:attempt-a:2'),
    );
    assert.equal(await adapter.reconcile(session, { id: 'task-one' } as any), 'completed');
    await host.native.selectModel('native-one', 'cfrproxy', 'model-b');
    await host.refresh();
    assert.equal(store.session(session.id).model, 'model-b');
    running = true;
    await adapter.steer(session, 'Change approach');
    assert.equal(
      received.findLast((r) => r.method === 'session/prompt').payload.args.request.mode,
      'steer',
    );
    running = false;
    await assert.rejects(adapter.steer(session, 'Too late'), /ended/);
    host.close();
    host = new DshHost({ id: 'dsh-host', name: 'Fred DSH', endpoint, tokenFile }, store);
    await host.refresh();
    const replacement = host.adapters.get(session.id)!;
    replacement.watch(session);
    for (const e of await replacement.read(session)) store.event(session, e);
    assert.equal(store.sessions().length, 1);
    assert.equal(store.events(session.id).filter((e) => e.kind === 'user.message').length, 1);
    missing = true;
    await host.refresh();
    assert.equal(store.session(session.id).connected, false);
  } finally {
    host.close();
    for (const socket of ws.clients) socket.terminate();
    await new Promise<void>((r) => ws.close(() => r()));
    await new Promise<void>((r) => server.close(() => r()));
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});
