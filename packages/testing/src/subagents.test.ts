import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, appendFile, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SubagentReader } from '../../adapters/src/subagents.ts';
import { fixture } from './helpers.ts';

test('subagent discovery requires native parent linkage; histories replay with stable IDs and cannot cross parents', async () => {
  const f = await fixture({ startRuntime: false });
  const root = await mkdtemp(path.join(os.tmpdir(), 'relay-children-'));
  try {
    const parent = {
      ...f.session,
      harness: 'codex' as const,
      nativeSessionId: 'parent',
      nativeSessionKind: 'id' as const,
    };
    const records = [
      {
        type: 'session_meta',
        payload: {
          id: 'child',
          source: {
            subagent: {
              thread_spawn: { parent_thread_id: 'parent', agent_path: '/root/reviewer' },
            },
          },
        },
      },
      {
        type: 'response_item',
        timestamp: '2026-10-13T12:00:00Z',
        payload: {
          id: 'message',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'Review complete' }],
        },
      },
    ];
    await writeFile(
      path.join(root, 'rollout-child.jsonl'),
      records.map((r) => JSON.stringify(r)).join('\n') + '\n',
    );
    await writeFile(
      path.join(root, 'unrelated.jsonl'),
      JSON.stringify({ type: 'session_meta', payload: { id: 'unrelated', source: 'cli' } }) + '\n',
    );
    const reader = new SubagentReader({ codex: root, claude: root });
    const children = await reader.list(parent);
    assert.equal(children.length, 1);
    assert.equal(children[0].name, '/root/reviewer');
    assert.equal(children[0].model, undefined);
    assert.equal(children[0].status, 'observed', 'missing native lifecycle stays unknown');
    const result = await reader.conversation(parent, children[0].id, Number.MAX_SAFE_INTEGER, 100);
    assert.equal(result.events[0].data.text, 'Review complete');
    assert.deepEqual(
      (await reader.conversation(parent, children[0].id, Number.MAX_SAFE_INTEGER, 100)).events,
      result.events,
    );
    const restarted = new SubagentReader({ codex: root, claude: root });
    assert.deepEqual(
      (await restarted.conversation(parent, children[0].id, Number.MAX_SAFE_INTEGER, 100)).events,
      result.events,
    );
    await assert.rejects(
      reader.conversation({ ...parent, nativeSessionId: 'other' }, children[0].id, 100, 100),
      /does not belong/,
    );
    assert.equal((await reader.conversation(parent, children[0].id, 1, 100)).events.length, 0);
    f.gateway.store.saveSession(parent);
    f.gateway.runtime.subagents = reader;
    const response = await f.gateway.app.inject({
      method: 'GET',
      url: `/api/sessions/${parent.id}/subagents`,
      headers: f.headers,
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().subagents[0].file, undefined);
    assert.equal(
      (await f.gateway.app.inject({ method: 'GET', url: `/api/sessions/${parent.id}/subagents` }))
        .statusCode,
      401,
    );
    assert.equal(
      (
        await f.gateway.app.inject({
          method: 'POST',
          url: `/api/sessions/${children[0].id}/messages`,
          headers: f.headers,
          payload: {},
        })
      ).statusCode >= 400,
      true,
    );
  } finally {
    await f.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('Claude children stay under the exact parent folder and skip symlinks', async () => {
  const f = await fixture({ startRuntime: false });
  const root = await mkdtemp(path.join(os.tmpdir(), 'relay-claude-children-'));
  try {
    const parent = {
      ...f.session,
      harness: 'claude' as const,
      nativeSessionId: 'parent',
      nativeSessionKind: 'id' as const,
    };
    await writeFile(path.join(root, 'parent.jsonl'), '{}\n');
    const dir = path.join(root, 'parent', 'subagents');
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, 'agent-review.jsonl'),
      JSON.stringify({
        uuid: 'message',
        type: 'assistant',
        timestamp: '2026-10-13T12:00:00Z',
        message: { model: 'claude-test', content: [{ type: 'text', text: 'Done' }] },
      }) + '\n',
    );
    await symlink(path.join(root, 'parent.jsonl'), path.join(dir, 'agent-link.jsonl'));
    const reader = new SubagentReader({ codex: root, claude: root });
    const children = await reader.list(parent);
    assert.equal(children.length, 1);
    assert.equal(children[0].model, 'claude-test');
    assert.equal(
      (await reader.conversation(parent, children[0].id, 100, 100)).events[0].data.text,
      'Done',
    );
    assert.equal(reader.supported({ ...parent, harness: 'dsh' }), false);
  } finally {
    await f.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('Claude catalog finds models beyond the prefix and refreshes working, idle, ended and resumed agents', async (t) => {
  const f = await fixture({ startRuntime: false });
  const root = await mkdtemp(path.join(os.tmpdir(), 'relay-agent-state-'));
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  const line = (record: unknown) => JSON.stringify(record) + '\n';
  try {
    const parent = {
      ...f.session,
      harness: 'claude',
      nativeSessionId: 'parent',
      nativeSessionKind: 'id' as const,
    };
    const parentFile = path.join(root, 'parent.jsonl');
    await writeFile(parentFile, '{}\n');
    const dir = path.join(root, 'parent', 'subagents');
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, 'agent-review.jsonl');
    await writeFile(
      file,
      line({ type: 'user', message: { content: 'Long initial context '.repeat(10000) } }) +
        '{broken record\n' +
        line({
          type: 'assistant',
          timestamp: '2026-10-24T10:00:00Z',
          message: {
            model: 'flash-next',
            stop_reason: 'tool_use',
            content: [{ type: 'tool_use' }],
          },
        }),
    );
    const reader = new SubagentReader({ claude: root, codex: root });
    const entry = async () => {
      now += 5001;
      return (await reader.list(parent))[0];
    };
    assert.equal((await entry()).model, 'flash-next');
    assert.equal((await entry()).status, 'working');
    await appendFile(
      file,
      line({
        type: 'assistant',
        timestamp: '2026-10-24T10:01:00Z',
        message: { model: 'flash-next-strata', stop_reason: 'end_turn' },
      }),
    );
    assert.equal((await entry()).status, 'idle');
    assert.equal((await entry()).model, 'flash-next-strata');
    await appendFile(
      parentFile,
      line({
        type: 'queue-operation',
        operation: 'enqueue',
        timestamp: '2026-10-24T10:02:00Z',
        content:
          '<task-notification><task-id>review</task-id><status>completed</status></task-notification>',
      }),
    );
    assert.equal((await entry()).status, 'ended');
    await appendFile(
      file,
      line({
        type: 'api-request',
        timestamp: '2026-10-24T10:03:00Z',
        params: { model: 'fred/flash-next' },
      }),
    );
    assert.equal(
      (await entry()).status,
      'working',
      'a resumed child supersedes its older completion',
    );
    assert.equal((await entry()).model, 'fred/flash-next');
    await writeFile(
      file,
      line({
        type: 'assistant',
        timestamp: '2026-10-24T10:04:00Z',
        message: { model: 'replacement-model', stop_reason: 'end_turn' },
      }),
    );
    assert.equal(
      (await entry()).model,
      'replacement-model',
      'truncation resets the summary cursor',
    );
    assert.equal((await entry()).status, 'idle');
    assert.equal(((await entry()) as any).file, undefined);
  } finally {
    t.mock.restoreAll();
    await f.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('Codex catalog reports native turn state and current model after long and partial records', async (t) => {
  const f = await fixture({ startRuntime: false });
  const root = await mkdtemp(path.join(os.tmpdir(), 'relay-codex-agent-state-'));
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  const line = (record: unknown) => JSON.stringify(record) + '\n';
  try {
    const parent = {
      ...f.session,
      harness: 'codex',
      nativeSessionId: 'parent',
      nativeSessionKind: 'id' as const,
    };
    const file = path.join(root, 'rollout-child.jsonl');
    await writeFile(
      file,
      line({
        type: 'session_meta',
        payload: {
          id: 'child',
          source: { subagent: { thread_spawn: { parent_thread_id: 'parent' } } },
        },
      }) +
        line({
          type: 'response_item',
          payload: { type: 'message', role: 'user', content: 'Context '.repeat(100000) },
        }) +
        line({ type: 'turn_context', payload: { model: 'gpt-6.1-sol' } }) +
        line({ type: 'event_msg', payload: { type: 'task_started' } }),
    );
    const reader = new SubagentReader({ codex: root, claude: root });
    const entry = async () => {
      now += 5001;
      return (await reader.list(parent))[0];
    };
    assert.equal((await entry()).model, 'gpt-6.1-sol');
    assert.equal((await entry()).status, 'working');
    const completion = line({ type: 'event_msg', payload: { type: 'task_complete' } });
    await appendFile(file, completion.slice(0, -2));
    assert.equal(
      (await entry()).status,
      'working',
      'partial lifecycle records are not interpreted',
    );
    await appendFile(file, completion.slice(-2));
    assert.equal((await entry()).status, 'idle');
    await appendFile(
      file,
      line({ type: 'turn_context', payload: { model: 'gpt-6.1-new' } }) +
        line({ type: 'event_msg', payload: { type: 'task_started' } }),
    );
    assert.equal((await entry()).model, 'gpt-6.1-new');
    assert.equal((await entry()).status, 'working');
    await appendFile(file, line({ type: 'event_msg', payload: { type: 'turn_aborted' } }));
    assert.equal((await entry()).status, 'idle');
    await appendFile(
      file,
      line({ type: 'response_item', payload: { text: 'x'.repeat(4 * 1024 * 1024 + 1) } }) +
        line({ type: 'event_msg', payload: { type: 'task_started' } }),
    );
    assert.equal(
      (await entry()).status,
      'working',
      'oversized context cannot hide later lifecycle records',
    );
  } finally {
    t.mock.restoreAll();
    await f.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('DSH linked conversations require exact host/parent identity and both read grants', async () => {
  const f = await fixture({ startRuntime: false });
  const { createHash } = await import('node:crypto');
  try {
    const parent = { ...f.session, harness: 'dsh', nativeSessionId: 'dsh-parent' };
    const child = {
      ...parent,
      id: 'dsh-child',
      nativeSessionId: 'native-child',
      parentSessionId: parent.id,
      sessionName: 'Review changes',
      status: 'working' as const,
    };
    f.gateway.store.saveSession(parent);
    f.gateway.store.saveSession(child);
    f.gateway.store.saveSession({ ...child, id: 'wrong-host', hostId: 'other' });
    f.gateway.store.saveSession({ ...child, id: 'wrong-parent', parentSessionId: 'elsewhere' });
    let prepared = '';
    f.gateway.runtime.prepareConversation = async (id) => {
      prepared = id;
    };
    f.gateway.store.event(child, {
      sourceId: 'child-reply',
      kind: 'assistant.message',
      timestamp: new Date().toISOString(),
      data: { text: 'Review finished' },
    });
    const url = `/api/sessions/${parent.id}/subagents`;
    const list = await f.gateway.app.inject({ url, headers: f.headers });
    assert.equal(list.statusCode, 200);
    const agents = list.json().subagents;
    assert.equal(agents.length, 1);
    assert.equal(agents[0].name, 'Review changes');
    assert.equal(agents[0].status, 'working');
    const opaque = createHash('sha256').update(`${parent.id}:${child.id}`).digest('hex');
    assert.equal(agents[0].id, opaque);
    const history = await f.gateway.app.inject({
      url: `${url}/${opaque}/events?limit=100`,
      headers: f.headers,
    });
    assert.equal(history.statusCode, 200);
    assert.equal(history.json().events[0].data.text, 'Review finished');
    assert.equal(prepared, child.id);
    assert.equal(
      (await f.gateway.app.inject({ url: `${url}/${'f'.repeat(64)}/events`, headers: f.headers }))
        .statusCode >= 400,
      true,
    );
    const device = f.gateway.auth.authenticate(f.headers.cookie.replace('rc_access=', ''));
    f.gateway.store.db.prepare('UPDATE devices SET admin=0 WHERE id=?').run(device.id);
    f.gateway.store.db
      .prepare('INSERT INTO grants(device_id,session_id,control) VALUES(?,?,0)')
      .run(device.id, parent.id);
    assert.equal(
      (await f.gateway.app.inject({ url, headers: f.headers })).json().subagents.length,
      0,
    );
    assert.equal(
      (await f.gateway.app.inject({ url: `${url}/${opaque}/events`, headers: f.headers }))
        .statusCode,
      403,
    );
    f.gateway.store.db
      .prepare('INSERT INTO grants(device_id,session_id,control) VALUES(?,?,0)')
      .run(device.id, child.id);
    assert.equal(
      (await f.gateway.app.inject({ url, headers: f.headers })).json().subagents.length,
      1,
    );
    assert.equal(
      (
        await f.gateway.app.inject({ url: `${url}/${opaque}/events?before=1`, headers: f.headers })
      ).json().events.length,
      0,
    );
  } finally {
    await f.close();
  }
});
