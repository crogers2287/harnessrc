import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fixture } from './helpers.ts';
import { HerdrCliAdapter, normalizeClaude } from '@harnessrc/adapters';
import { TaskQueue } from '@harnessrc/task-queue';
import { capabilities } from '@harnessrc/protocol';

async function cliFixture() {
  const f = await fixture({ harness: 'claude', startRuntime: false });
  const session = f.session;
  session.capabilities = capabilities([
    'readConversation',
    'streamConversation',
    'sendMessage',
    'queueTask',
  ]);
  f.gateway.store.saveSession(session);
  const original = f.mock.herdr.bind(f.mock);
  f.mock.herdr = (request: any) => {
    if (request.method === 'agent.prompt') {
      assert.equal(request.params.target, f.mock.paneId);
      f.mock.prompts.push(request.params.text);
      return { type: 'agent_prompted', agent: f.mock.agent() };
    }
    return original(request);
  };
  const adapter = new HerdrCliAdapter(
    { capabilities: session.capabilities as any, read: async () => [] },
    f.gateway.runtime.clients.get('test')!,
    f.gateway.store,
    (s) => f.gateway.runtime.assertBinding(s),
  );
  const queue = new TaskQueue(f.gateway.store, () => adapter);
  return { ...f, session, adapter, queue };
}

test('CLI prompts reach the existing process and two queued turns require native completion in order', async () => {
  const f = await cliFixture();
  try {
    const first = f.queue.add(f.session.id, { prompt: 'first', idempotencyKey: randomUUID() });
    const second = f.queue.add(f.session.id, { prompt: 'second', idempotencyKey: randomUUID() });
    await f.queue.tick(f.session.id);
    assert.deepEqual(f.mock.prompts, ['first']);
    await f.queue.tick(f.session.id);
    assert.deepEqual(f.mock.prompts, ['first']); // An idle pane alone does not complete a task.
    for (const record of [
      {
        type: 'user',
        uuid: 'u1',
        timestamp: new Date().toISOString(),
        message: { content: 'first' },
      },
      {
        type: 'assistant',
        uuid: 'a1',
        timestamp: new Date().toISOString(),
        message: { content: [{ type: 'text', text: 'Done' }], stop_reason: 'end_turn' },
      },
    ])
      for (const event of normalizeClaude(record)) f.gateway.store.event(f.session, event);
    await f.queue.tick(f.session.id);
    assert.equal(f.gateway.store.task(first.id).status, 'completed');
    assert.deepEqual(f.mock.prompts, ['first', 'second']);
    assert.equal(f.gateway.store.task(second.id).status, 'running');
  } finally {
    await f.close();
  }
});

test('CLI dispatch defers busy or blocked agents and rejects a replaced foreground process', async () => {
  const f = await cliFixture();
  try {
    const task = f.queue.add(f.session.id, { prompt: 'hello', idempotencyKey: randomUUID() });
    f.mock.status = 'blocked';
    await f.queue.tick(f.session.id);
    assert.equal(f.gateway.store.task(task.id).status, 'pending');
    assert.deepEqual(f.mock.prompts, []);
    f.mock.status = 'idle';
    f.mock.foregroundPid++;
    await f.queue.tick(f.session.id);
    assert.equal(f.gateway.store.task(task.id).status, 'uncertain');
    assert.deepEqual(f.mock.prompts, []);
  } finally {
    await f.close();
  }
});

test('CLI acknowledgement loss reconciles from native history without resending after restart', async () => {
  const f = await cliFixture();
  try {
    const client = f.gateway.runtime.clients.get('test')!;
    const original = client.request.bind(client);
    client.request = async (method, params, timeout) => {
      const result = await original(method, params, timeout);
      if (method === 'agent.prompt') throw new Error('Lost acknowledgement');
      return result;
    };
    const task = f.queue.add(f.session.id, { prompt: 'hello', idempotencyKey: randomUUID() });
    await f.queue.tick(f.session.id);
    assert.equal(f.gateway.store.task(task.id).status, 'uncertain');
    const recovered = new TaskQueue(f.gateway.store, () => f.adapter);
    await recovered.tick(f.session.id);
    assert.deepEqual(f.mock.prompts, ['hello']);
    for (const record of [
      {
        type: 'user',
        uuid: 'u2',
        timestamp: new Date().toISOString(),
        message: { content: 'hello' },
      },
      {
        type: 'assistant',
        uuid: 'a2',
        timestamp: new Date().toISOString(),
        message: { content: [{ type: 'text', text: 'Done' }], stop_reason: 'end_turn' },
      },
    ])
      for (const event of normalizeClaude(record)) f.gateway.store.event(f.session, event);
    await recovered.tick(f.session.id);
    assert.equal(f.gateway.store.task(task.id).status, 'completed');
    assert.deepEqual(f.mock.prompts, ['hello']);
  } finally {
    await f.close();
  }
});

test('native session titles and CWD survive discovery', async () => {
  const f = await fixture({ startRuntime: false });
  try {
    const original = f.mock.agent.bind(f.mock);
    f.mock.agent = () => ({
      ...original(),
      name: 'API refactor',
      terminal_title_stripped: 'Other title',
      foreground_cwd: '/work/nested-project',
    });
    const originalHerdr = f.mock.herdr.bind(f.mock);
    f.mock.herdr = (request): any =>
      request.method === 'pane.process_info'
        ? {
            process_info: {
              shell_pid: 1234,
              foreground_process_group_id: 5678,
              foreground_processes: [
                { pid: 20, name: 'bun', cwd: '/plugins/helper' },
                { pid: 5678, name: 'codex', cwd: '/work/nested-project' },
              ],
            },
          }
        : originalHerdr(request);
    await f.gateway.runtime.refresh('test');
    assert.equal(f.session.sessionName, 'API refactor');
    assert.equal(f.session.cwd, '/work/nested-project');
  } finally {
    await f.close();
  }
});
