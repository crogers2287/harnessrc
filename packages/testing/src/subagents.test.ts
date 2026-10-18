import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
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
