import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store } from '@harnessrc/storage';
import { HerdrClient } from '@harnessrc/herdr';
import { Launcher, launchProfileSchema } from '../../../apps/gateway/src/launch.ts';

test('launch passes verified CWD/model to Herdr, claims atomically, and replays across restarts', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'launch-'));
  const store = new Store(':memory:');
  const calls: { method: string; params: any }[] = [];
  const client = new HerdrClient('fred', '/unused');
  client.host.connected = true;
  let agentName = '';
  client.request = async (method, params: any) => {
    calls.push({ method, params });
    if (method === 'agent.start') agentName = params.name;
    if (method === 'agent.get')
      return {
        agent: {
          terminal_id: 'terminal',
          agent: 'codex',
          name: agentName,
          interactive_ready: true,
        },
      };
    return { root_pane: { pane_id: 'w1:p3', terminal_id: 'terminal' } };
  };
  const profiles = [
    launchProfileSchema.parse({
      id: 'codex',
      hostId: 'fred',
      label: 'Codex',
      harness: 'codex',
      workspaceId: 'w1',
      roots: [root],
      allowCustomModel: true,
      args: ['-c', 'model_provider="local_models"'],
    }),
  ];
  const launcher = new Launcher(store, profiles, new Map([['fred', client]]));
  try {
    const request = {
      requestId: randomUUID(),
      profileId: 'codex',
      cwd: root,
      model: 'fred/qwen38-27b',
      name: 'Mobile session',
      prompt: 'Check project',
    };
    const results = await Promise.all([
      launcher.launch(request, 'device'),
      launcher.launch(request, 'device'),
    ]);
    assert.equal(calls.length, 4);
    assert.equal(results[0].status, 'started');
    assert.equal(calls[0].params.cwd, root);
    assert.equal(calls[0].params.focus, false);
    assert.deepEqual(calls[1].params.args, [
      '-c',
      'model_provider="local_models"',
      '--model',
      'fred/qwen38-27b',
    ]);
    const next = new Launcher(store, profiles, new Map([['fred', client]]));
    next.recover();
    assert.equal((await next.launch(request, 'device')).status, 'started');
    assert.equal(calls.length, 4);
    await assert.rejects(
      () => next.launch({ ...request, model: 'different' }, 'device'),
      /different settings/,
    );
    await assert.rejects(
      () =>
        launcher.launch(
          { ...request, requestId: randomUUID(), model: 'x;touch /tmp/pwn' },
          'device',
        ),
      /supported model/,
    );
    await mkdir(path.join(root, 'project'));
    await symlink('/etc', path.join(root, 'outside'));
    assert.deepEqual(
      (await launcher.folders('codex')).directories.map((d) => d.name),
      ['project'],
    );
    await assert.rejects(
      () => launcher.directory('codex', path.join(root, 'outside')),
      /outside permitted/,
    );
    await assert.rejects(
      () => launcher.directory('codex', path.join(root, '..')),
      /outside permitted/,
    );
  } finally {
    store.close();
    await rm(root, { recursive: true });
  }
});
test('lost start confirmation and gateway restart never launch an agent twice', async () => {
  const store = new Store(':memory:');
  const client = new HerdrClient('fred', '/unused');
  client.host.connected = true;
  let calls = 0;
  client.request = async (method) => {
    calls++;
    if (method === 'agent.start') throw new Error('lost confirmation SECRET');
    return { root_pane: { pane_id: 'w1:p2', terminal_id: 'term' } };
  };
  const profiles = [
    launchProfileSchema.parse({
      id: 'claude',
      hostId: 'fred',
      label: 'Claude',
      harness: 'claude',
      workspaceId: 'w1',
      roots: [tmpdir()],
    }),
  ];
  const launcher = new Launcher(store, profiles, new Map([['fred', client]]));
  const request = {
    requestId: randomUUID(),
    profileId: 'claude',
    cwd: tmpdir(),
    model: '',
    name: 'Test',
    prompt: 'Reply ready',
  };
  try {
    const result = await launcher.launch(request, 'device');
    assert.equal(result.status, 'uncertain');
    assert.equal(JSON.stringify(result).includes('SECRET'), false);
    await launcher.launch(request, 'device');
    assert.equal(calls, 2);
    store.db
      .prepare('UPDATE launches SET receipt=?')
      .run(JSON.stringify({ ...result, status: 'starting' }));
    launcher.recover();
    assert.equal(launcher.receipt(request.requestId)?.status, 'uncertain');
    await launcher.launch(request, 'device');
    assert.equal(calls, 2);
  } finally {
    store.close();
  }
});

test('new shell readiness retries only a definite busy rejection and checks the terminal before retry', async () => {
  const { HerdrError } = await import('@harnessrc/herdr');
  const store = new Store(':memory:');
  const client = new HerdrClient('fred', '/unused');
  client.host.connected = true;
  const profile = launchProfileSchema.parse({
    id: 'codex',
    hostId: 'fred',
    label: 'Codex',
    harness: 'codex',
    workspaceId: 'w1',
    roots: [tmpdir()],
  });
  let starts = 0,
    prompts = 0,
    reads = 0,
    name = '',
    replaced = false;
  client.request = async (method, p: any) => {
    if (method === 'tab.create') return { root_pane: { pane_id: 'w1:p2', terminal_id: 'term' } };
    if (method === 'agent.start') {
      name = p.name;
      if (++starts === 1) throw new HerdrError('agent_pane_busy', 'Shell initializing');
      return {};
    }
    if (method === 'pane.get') return { pane: { terminal_id: replaced ? 'replacement' : 'term' } };
    if (method === 'agent.get')
      return {
        agent: {
          name,
          terminal_id: 'term',
          agent: ++reads > 1 ? 'codex' : null,
          interactive_ready: reads > 1,
        },
      };
    if (method === 'agent.prompt') {
      prompts++;
      assert.equal(p.text, 'A multiline\nfirst message');
      return {};
    }
    throw new Error(method);
  };
  const launcher = new Launcher(store, [profile], new Map([['fred', client]]));
  const input = {
    requestId: randomUUID(),
    profileId: 'codex',
    cwd: tmpdir(),
    name: 'Human friendly title',
    model: '',
    prompt: 'A multiline\nfirst message',
  };
  try {
    assert.equal((await launcher.launch(input, 'device')).status, 'started');
    assert.equal(starts, 2);
    assert.equal(prompts, 1);
    starts = 0;
    replaced = true;
    assert.equal(
      (await launcher.launch({ ...input, requestId: randomUUID() }, 'device')).status,
      'uncertain',
    );
    assert.equal(starts, 1);
    assert.equal(prompts, 1);
  } finally {
    store.close();
  }
});

test('new Codex threads are named before their first Herdr CLI owner starts; replay never creates another thread', async () => {
  const { CodexDaemon } = await import('../../../packages/adapters/src/codex-daemon.ts');
  const original = CodexDaemon.prototype.request;
  const nativeCalls: { method: string; params: any }[] = [];
  const nativeId = randomUUID();
  CodexDaemon.prototype.request = async function (method, params) {
    nativeCalls.push({ method, params });
    if (method === 'thread/start') return { thread: { id: nativeId } };
    if (method === 'thread/name/set') return {};
    throw new Error('Unexpected native operation: ' + method);
  };
  const store = new Store(':memory:');
  const client = new HerdrClient('fred', '/unused');
  client.host.connected = true;
  let start: any;
  client.request = async (method, params: any) => {
    if (method === 'tab.create') return { root_pane: { pane_id: 'w1:p2', terminal_id: 'term' } };
    if (method === 'agent.start') {
      start = params;
      return {};
    }
    if (method === 'agent.get')
      return {
        agent: {
          name: start.name,
          terminal_id: 'term',
          agent: 'codex',
          interactive_ready: true,
          agent_session: { value: nativeId },
        },
      };
    if (method === 'agent.prompt') return {};
    throw new Error(method);
  };
  const profile = launchProfileSchema.parse({
    id: 'codex',
    hostId: 'fred',
    label: 'Codex',
    harness: 'codex',
    workspaceId: 'w1',
    roots: [tmpdir()],
    codexProvider: 'local_models',
    defaultModel: 'codex/gpt-6.1-sol',
    allowCustomModel: true,
  });
  const launcher = new Launcher(
    store,
    [profile],
    new Map([['fred', client]]),
    new Map([['fred', '/private/daemon.sock']]),
  );
  const request = {
    requestId: randomUUID(),
    profileId: 'codex',
    cwd: tmpdir(),
    name: 'Native launch',
    model: '',
    prompt: 'Hello',
  };
  try {
    assert.equal((await launcher.launch(request, 'device')).status, 'started');
    assert.deepEqual(
      nativeCalls.map((c) => c.method),
      ['thread/start', 'thread/name/set'],
    );
    assert.equal(nativeCalls[0].params.modelProvider, 'local_models');
    assert.equal(nativeCalls[0].params.model, 'codex/gpt-6.1-sol');
    assert.equal(nativeCalls[1].params.threadId, nativeId);
    assert.deepEqual(start.args, [
      'resume',
      nativeId,
      '--remote',
      'unix:///private/daemon.sock',
      '--model',
      'codex/gpt-6.1-sol',
    ]);
    await launcher.launch(request, 'device');
    assert.equal(nativeCalls.length, 2);
    assert.equal(launcher.receipt(request.requestId)?.nativeSessionId, nativeId);
  } finally {
    CodexDaemon.prototype.request = original;
    store.close();
  }
});
