import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile, mkdir, appendFile, symlink } from 'node:fs/promises';
import path from 'node:path';
import { Store } from '@harnessrc/storage';
import { redact, capabilities } from '@harnessrc/protocol';
import { sessionFromAgent } from '@harnessrc/herdr';
import {
  normalizeClaude,
  normalizeCodex,
  normalizeOmp,
  JsonlAdapter,
  resolveTranscript,
  codexRequestInteraction,
  normalizeCodexNotification,
  HermesAdapter,
  OpenCodeAdapter,
} from '@harnessrc/adapters';
import { validateResponse } from '@harnessrc/interaction-broker';
import { TaskQueue } from '@harnessrc/task-queue';
import { fixture, eventually } from './helpers.ts';
import { DatabaseSync } from 'node:sqlite';
import http from 'node:http';
const prompt = (text: string, key = randomUUID()) => ({ prompt: text, idempotencyKey: key });
test('immutable ordered replay deduplicates native ids and redacts secrets', () => {
  const store = new Store(':memory:');
  const session = sessionFromAgent(
    'test',
    {
      terminal_id: 't',
      pane_id: 'w1:p1',
      workspace_id: 'w1',
      agent_status: 'idle',
      agent_session: { agent: 'claude', value: 'native', kind: 'id', source: 'test' },
    },
    'Project',
  );
  store.saveSession(session);
  const event = {
    sourceId: 'uuid:block',
    kind: 'assistant.message' as const,
    timestamp: new Date().toISOString(),
    data: {
      text: 'api_key=secret-value',
      authorization: 'Bearer hello',
      nested: { password: 'sensitive' },
    },
  };
  const first = store.event(session, event);
  const replay = store.event(session, { ...event, data: { text: 'changed' } });
  assert.equal(first.sequence, replay.sequence);
  assert.equal(store.events(session.id).length, 1);
  assert.equal(replay.data.text, 'api_key=[REDACTED]');
  assert.deepEqual(redact({ nested: { password: 'x' } }), { nested: { password: '[REDACTED]' } });
  store.close();
});
test('native identity survives pane relocation but changes across native replacement', () => {
  const a = {
    terminal_id: 't',
    pane_id: 'w1:p1',
    workspace_id: 'w1',
    agent_status: 'idle' as const,
    agent_session: { agent: 'codex', kind: 'id' as const, value: 'native', source: 'test' },
  };
  const first = sessionFromAgent('host', a, 'Project');
  assert.equal(first.id, sessionFromAgent('host', { ...a, pane_id: 'w3:p4' }, 'Project').id);
  assert.notEqual(
    first.id,
    sessionFromAgent(
      'host',
      { ...a, agent_session: { ...a.agent_session, value: 'different' } },
      'Project',
    ).id,
  );
  assert.notEqual(first.id, sessionFromAgent('another', a, 'Project').id);
});
test('Claude transcript parses text and tools without inventing reasoning', () => {
  const events = normalizeClaude({
    uuid: 'u',
    type: 'assistant',
    timestamp: '2026-01-01T00:00:00Z',
    message: {
      content: [
        { type: 'text', text: 'Hello' },
        { type: 'thinking', thinking: 'private' },
        { type: 'tool_use', id: 'tool', name: 'Bash', input: { command: 'pwd' } },
      ],
    },
  });
  assert.deepEqual(
    events.map((e) => e.kind),
    ['assistant.message', 'tool.invocation'],
  );
  assert.equal(events[1].data.toolId, 'tool');
});
test('Codex canonical rollout avoids duplicate event_msg conversation entries', () => {
  const events = normalizeCodex(
    {
      type: 'response_item',
      payload: {
        type: 'message',
        id: 'm1',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'Hi' }],
      },
    },
    0,
  );
  assert.equal(events[0].data.text, 'Hi');
  assert.equal(
    normalizeCodex({ type: 'event_msg', payload: { type: 'agent_message', message: 'Hi' } }, 1)
      .length,
    0,
  );
  assert.equal(
    normalizeCodexNotification(
      'item/agentMessage/delta',
      { threadId: 't', itemId: 'i', delta: 'Hello' },
      1,
    )[0].kind,
    'assistant.delta',
  );
});
test('OMP branch history retains parent identity and native tool ids', () => {
  const events = normalizeOmp({
    type: 'message',
    id: 'a',
    parentId: 'b',
    message: {
      role: 'assistant',
      content: [
        { type: 'text', text: 'Hi' },
        { type: 'toolCall', id: 'tool', name: 'read', arguments: { path: 'a' } },
      ],
    },
  });
  assert.equal(events[0].data.parentId, 'b');
  assert.equal(events[1].data.toolId, 'tool');
});
test('native question and approval conversion preserves exact request identity', () => {
  const approval = codexRequestInteraction({
    id: 12,
    method: 'item/commandExecution/requestApproval',
    params: { threadId: 't', turnId: 'turn', itemId: 'i', command: 'npm test' },
  })!;
  assert.equal(approval.nativeRequestId, '12');
  assert.equal(approval.turnId, 'turn');
  validateResponse(approval.responseSchema, 'accept');
  assert.throws(() => validateResponse(approval.responseSchema, 'acceptForSession'));
  const question = codexRequestInteraction({
    id: 'q',
    method: 'item/tool/requestUserInput',
    params: { questions: [{ id: 'choice', question: 'Which?' }] },
  })!;
  validateResponse(question.responseSchema, { answers: { choice: { answers: ['A'] } } });
  assert.throws(() =>
    validateResponse(question.responseSchema, { answers: { other: { answers: ['A'] } } }),
  );
  assert.throws(() =>
    validateResponse(question.responseSchema, { answers: { choice: { answers: [] } } }),
  );
  assert.equal(codexRequestInteraction({ id: 'x', method: 'unknown', params: {} }), undefined);
});
test('JSONL tailer handles partial records, UTF-8, rotation, and root escape', async () => {
  const f = await fixture({ startRuntime: false });
  try {
    const s = { ...f.session, harness: 'claude', nativeSessionId: 'native' };
    const file = path.join(f.dir, 'project', 'native.jsonl');
    await mkdir(path.dirname(file));
    const json = JSON.stringify({
      uuid: 'record',
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'héllo 👋' }] },
    });
    await writeFile(file, json.slice(0, 20));
    const adapter = new JsonlAdapter(f.dir, 'claude');
    assert.equal((await adapter.read(s)).length, 0);
    await appendFile(file, json.slice(20) + '\n');
    assert.equal((await adapter.read(s))[0].data.text, 'héllo 👋');
    assert.equal((await adapter.read(s)).length, 0);
    await writeFile(
      file,
      JSON.stringify({ uuid: 'new', type: 'user', message: { content: 'short' } }) + '\n',
    );
    assert.equal((await adapter.read(s))[0].sourceId, 'new');
    const outside = path.join('/tmp', `outside-${randomUUID()}.jsonl`);
    await symlink('/etc/passwd', path.join(f.dir, 'escape.jsonl'));
    await assert.rejects(
      () =>
        resolveTranscript(
          { ...s, nativeSessionKind: 'path', nativeSessionId: path.join(f.dir, 'escape.jsonl') },
          f.dir,
        ),
      /outside/,
    );
    void outside;
  } finally {
    await f.close();
  }
});
test('Hermes read path selects only the exact native session', async () => {
  const f = await fixture({ startRuntime: false });
  try {
    const file = path.join(f.dir, 'hermes.db');
    const db = new DatabaseSync(file);
    db.exec(
      "CREATE TABLE messages(id INTEGER PRIMARY KEY,session_id TEXT,role TEXT,content TEXT,timestamp REAL); INSERT INTO messages VALUES(1,'s','user','Hello',1760000000),(2,'other','assistant','Wrong session',1760000001)",
    );
    db.close();
    const events = await new HermesAdapter(file).read({ ...f.session, nativeSessionId: 's' });
    assert.equal(events.length, 1);
    assert.equal(events[0].data.text, 'Hello');
  } finally {
    await f.close();
  }
});
test('OpenCode documented message endpoint normalizes structured parts', async () => {
  const server = http.createServer((req, res) => {
    assert.equal(req.url, '/session/native/message');
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify([
        {
          info: { id: 'm', role: 'assistant', time: { created: 1760000000000 } },
          parts: [{ id: 'p', type: 'text', text: 'Hello' }],
        },
      ]),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  const f = await fixture({ startRuntime: false });
  try {
    const events = await new OpenCodeAdapter(`http://127.0.0.1:${address.port}`).read({
      ...f.session,
      nativeSessionId: 'native',
    });
    assert.equal(events[0].sourceId, 'opencode:m:p');
    assert.equal(events[0].data.text, 'Hello');
  } finally {
    await f.close();
    server.close();
  }
});
test('queue add is idempotent, validates key reuse, reorder/edit/cancel, pause', async () => {
  const f = await fixture({ startRuntime: false });
  try {
    const q = f.gateway.runtime.queue;
    const id = f.session.id;
    const key = randomUUID();
    const a = q.add(id, prompt('First', key));
    assert.equal(q.add(id, prompt('First', key)).id, a.id);
    assert.throws(() => q.add(id, prompt('Different', key)));
    const b = q.add(id, prompt('Second'));
    q.reorder(id, [b.id, a.id]);
    assert.equal(f.gateway.store.tasks(id)[0].id, b.id);
    assert.throws(() => q.reorder(id, [a.id, a.id]));
    q.edit(id, a.id, 'Changed');
    q.cancel(id, b.id);
    q.pause(id, true);
    await q.tick(id);
    assert.equal(f.mock.prompts.length, 0);
    q.pause(id, false);
    await q.tick(id);
    assert.deepEqual(f.mock.prompts, ['Changed']);
  } finally {
    await f.close();
  }
});
test('serial scheduler blocks for exact questions and preserves two followups', async () => {
  const f = await fixture();
  try {
    const { runtime, store } = f.gateway;
    const id = f.session.id;
    const first = runtime.queue.add(id, prompt('Ask a question'));
    runtime.queue.add(id, prompt('Second'));
    runtime.queue.add(id, prompt('Third'));
    // This exercises multiple durable fsyncs and scheduler ticks, not a latency SLA.
    await eventually(() => store.interactions(id).some((i) => i.status === 'pending'), 15000);
    assert.deepEqual(f.mock.prompts, ['Ask a question']);
    const i = store.interactions(id).find((i) => i.status === 'pending')!;
    await assert.rejects(() => runtime.broker.respond(i.id, 'not-a-choice', 'test'), /offered/);
    await runtime.broker.respond(i.id, 'strict', 'test');
    await eventually(() => store.tasks(id).every((t) => t.status === 'completed'), 15000);
    assert.deepEqual(f.mock.prompts, ['Ask a question', 'Second', 'Third']);
    assert.equal(store.task(first.id).attempts, 1);
  } finally {
    await f.close();
  }
});
test('pending interaction double submission permits exactly one native response', async () => {
  const f = await fixture();
  try {
    const { runtime, store } = f.gateway;
    runtime.queue.add(f.session.id, prompt('Need approval'));
    await eventually(() => store.interactions(f.session.id).some((i) => i.status === 'pending'));
    const i = store.interactions(f.session.id)[0];
    const results = await Promise.allSettled([
      runtime.broker.respond(i.id, 'accept', 'device'),
      runtime.broker.respond(i.id, 'decline', 'device'),
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(f.mock.events.filter((e) => e.kind === 'progress').length, 1);
  } finally {
    await f.close();
  }
});
test('expired and replaced pending interactions cannot execute', async () => {
  const f = await fixture({ startRuntime: false });
  try {
    const { runtime, store } = f.gateway;
    const i = runtime.broker.open(f.session.id, {
      nativeRequestId: 'old',
      type: 'confirmation',
      prompt: 'Allow?',
      choices: [],
      responseSchema: { type: 'boolean' },
      expiresAt: new Date(Date.now() - 1).toISOString(),
      route: 'mock',
    });
    await assert.rejects(() => runtime.broker.respond(i.id, true, 'device'), /expired/);
    runtime.broker.expire();
    assert.equal(store.interaction(i.id).status, 'expired');
    const active = runtime.broker.open(f.session.id, {
      nativeRequestId: 'new',
      type: 'confirmation',
      prompt: 'Allow?',
      choices: [],
      responseSchema: { type: 'boolean' },
      expiresAt: new Date(Date.now() + 60000).toISOString(),
      route: 'mock',
    });
    f.mock.replace();
    await runtime.refresh('test');
    runtime.broker.expire();
    await assert.rejects(() => runtime.broker.respond(active.id, true, 'device'));
    assert.equal(store.interaction(active.id).status, 'stale');
  } finally {
    await f.close();
  }
});
test('same native session in a replaced terminal invalidates queued ownership', async () => {
  const f = await fixture({ startRuntime: false });
  try {
    const { runtime, store } = f.gateway;
    const original = f.session;
    const task = runtime.queue.add(original.id, prompt('Do not send to replacement'));
    f.mock.terminalId = 'replacement-terminal';
    await runtime.refresh('test');
    assert.equal(f.session.id, original.id);
    assert.notEqual(f.session.generation, original.generation);
    await runtime.queue.tick(original.id);
    assert.equal(store.task(task.id).status, 'failed');
    assert.equal(f.mock.prompts.length, 0);
  } finally {
    await f.close();
  }
});
test('foreground process replacement with unchanged pane and native id prevents dispatch', async () => {
  const f = await fixture({ startRuntime: false });
  try {
    const { runtime, store } = f.gateway;
    const original = f.session;
    const task = runtime.queue.add(original.id, prompt('Owner-bound task'));
    f.mock.foregroundPid++;
    await runtime.refresh('test');
    assert.equal(f.session.id, original.id);
    assert.notEqual(f.session.generation, original.generation);
    await runtime.queue.tick(original.id);
    assert.equal(store.task(task.id).status, 'failed');
    assert.equal(f.mock.prompts.length, 0);
  } finally {
    await f.close();
  }
});
test('lost dispatch confirmation stays uncertain and is never blindly resent', async () => {
  const f = await fixture({ startRuntime: false });
  try {
    const { store } = f.gateway;
    const s = f.session;
    let sends = 0;
    const adapter = {
      capabilities: capabilities(['queueTask']),
      read: async () => [],
      send: async () => {
        sends++;
        throw new Error('lost acknowledgement');
      },
    };
    const queue = new TaskQueue(store, () => adapter);
    queue.add(s.id, prompt('Run once'));
    await queue.tick(s.id);
    await queue.tick(s.id);
    assert.equal(sends, 1);
    assert.equal(store.tasks(s.id)[0].status, 'uncertain');
  } finally {
    await f.close();
  }
});
test('restart recovers queued tasks, pending requests, and uncertain claims without duplication', async () => {
  const f = await fixture();
  try {
    const id = f.session.id;
    const q = f.gateway.runtime.queue;
    q.add(id, prompt('Need approval'));
    await eventually(() => f.gateway.store.interactions(id).some((i) => i.status === 'pending'));
    q.add(id, prompt('After restart'));
    const before = f.gateway.store.events(id).map((e) => e.id);
    await f.restart();
    await eventually(() => f.gateway.store.interactions(id).some((i) => i.status === 'pending'));
    for (const event of before) assert.ok(f.gateway.store.events(id).some((e) => e.id === event));
    assert.equal(f.mock.prompts.length, 1);
    await f.gateway.runtime.broker.respond(
      f.gateway.store.interactions(id).find((i) => i.status === 'pending')!.id,
      'accept',
      'device',
    );
    await eventually(() => f.gateway.store.tasks(id).every((t) => t.status === 'completed'));
    assert.deepEqual(f.mock.prompts, ['Need approval', 'After restart']);
  } finally {
    await f.close();
  }
});
test('subscription reconnect reconciles an authoritative snapshot', async () => {
  const f = await fixture();
  try {
    const client = f.gateway.runtime.clients.get('test')!;
    client.subscription!.destroy();
    await eventually(() => !f.gateway.store.session(f.session.id).connected);
    await eventually(() => f.gateway.store.session(f.session.id).connected);
    f.mock.move();
    await eventually(() => f.gateway.store.session(f.session.id).paneId === 'w2:p3');
    assert.equal(f.gateway.store.sessions().length, 1);
  } finally {
    await f.close();
  }
});
