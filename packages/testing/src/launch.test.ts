import { createServer } from 'node:http';
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
  let permissionsMismatch = false;
  let modelMismatch = false;
  let prompts = 0;
  CodexDaemon.prototype.request = async function (method, params) {
    nativeCalls.push({ method, params });
    if (method === 'thread/start') return { thread: { id: nativeId } };
    if (method === 'thread/name/set' || method === 'thread/settings/update') return {};
    if (method === 'turn/start') {
      prompts++;
      return { turn: { id: 'first-turn' } };
    }
    if (method === 'thread/resume')
      return {
        thread: { id: nativeId },
        model: modelMismatch ? 'wrong-model' : 'codex/gpt-6.1-sol',
        modelProvider: 'local_models',
        sandbox: { type: permissionsMismatch ? 'readOnly' : 'workspaceWrite' },
        approvalPolicy: 'on-request',
      };
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
    if (method === 'agent.prompt') {
      throw new Error('Native Codex launch must not paste into the terminal');
    }
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
    args: ['-c', 'model_provider="local_models"'],
    permissionPresets: [
      {
        id: 'workspace',
        name: 'Workspace',
        args: ['--sandbox', 'workspace-write', '--ask-for-approval', 'on-request'],
        sandbox: 'workspace-write',
        approvalPolicy: 'on-request',
      },
    ],
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
    permission: 'workspace',
    permissionConfirmed: true,
    model: '',
    prompt: 'Hello',
  };
  try {
    assert.equal((await launcher.launch(request, 'device')).status, 'started');
    assert.deepEqual(
      nativeCalls.map((c) => c.method),
      [
        'thread/start',
        'thread/name/set',
        'thread/settings/update',
        'thread/resume',
        'thread/resume',
        'turn/start',
      ],
    );
    assert.equal(nativeCalls[0].params.sandbox, 'workspace-write');
    assert.equal(nativeCalls[0].params.approvalPolicy, 'on-request');
    assert.equal(nativeCalls[0].params.modelProvider, 'local_models');
    assert.equal(nativeCalls[0].params.model, 'codex/gpt-6.1-sol');
    assert.equal(nativeCalls[1].params.threadId, nativeId);
    assert.deepEqual(nativeCalls[2].params, {
      threadId: nativeId,
      permissions: ':workspace',
      approvalPolicy: 'on-request',
    });
    assert.deepEqual(start.args, ['resume', nativeId, '--remote', 'unix:///private/daemon.sock']);
    await launcher.launch(request, 'device');
    assert.equal(nativeCalls.length, 6);
    assert.equal(launcher.receipt(request.requestId)?.nativeSessionId, nativeId);
    permissionsMismatch = true;
    assert.equal(
      (await launcher.launch({ ...request, requestId: randomUUID() }, 'device')).status,
      'uncertain',
    );
    assert.equal(prompts, 1, 'never send the first instruction with unconfirmed permissions');
    permissionsMismatch = false;
    modelMismatch = true;
    assert.equal(
      (await launcher.launch({ ...request, requestId: randomUUID() }, 'device')).status,
      'uncertain',
    );
    assert.equal(prompts, 1, 'never send the first instruction to an unconfirmed provider/model');
  } finally {
    CodexDaemon.prototype.request = original;
    store.close();
  }
});

test('DSH launch discovers presets, validates selection before mutation and preserves it on replay', async () => {
  const store = new Store(':memory:');
  const calls: { method: string; args: any }[] = [];
  const host: any = {
    connected: true,
    native: {
      call: async (method: string, args: any) => {
        calls.push({ method, args });
        if (method === 'permissionPresets/catalog') return { options: [] };
        if (method === 'agentPresets/list')
          return {
            presets: [
              { id: 'standard', isDefault: true },
              { id: 'haxor', name: 'Haxor' },
              { id: 'ash' },
              { id: 'minimal' },
              { id: 'broken', broken: 'Missing tools' },
            ],
          };
        return {};
      },
      models: async () => ({ groups: [] }),
      prompt: async () => {},
    },
  };
  const profile = launchProfileSchema.parse({
    id: 'dsh',
    hostId: 'fred-dsh',
    label: 'DSH',
    harness: 'dsh',
    workspaceId: 'dsh',
    roots: [tmpdir()],
  });
  const launcher = new Launcher(
    store,
    [profile],
    new Map(),
    new Map(),
    new Map([['fred-dsh', host]]),
  );
  const input = {
    requestId: randomUUID(),
    profileId: 'dsh',
    cwd: tmpdir(),
    name: 'Chosen agent',
    model: '',
    prompt: 'Hello',
    agentPreset: 'haxor',
  };
  try {
    const [catalog] = await launcher.catalog();
    assert.ok('defaultAgentPreset' in catalog && 'agentPresets' in catalog);
    assert.equal(catalog.defaultAgentPreset, 'standard');
    assert.equal(catalog.agentPresets?.find((p) => p.id === 'broken')?.unavailable, true);
    for (const agentPreset of ['missing', 'broken']) {
      await assert.rejects(
        launcher.launch({ ...input, agentPreset }, 'device'),
        /available DSH agent/,
      );
      assert.equal(launcher.receipt(input.requestId), undefined);
    }
    assert.equal(
      calls.some((c) => c.method === 'session/create'),
      false,
    );
    assert.equal((await launcher.launch(input, 'device')).status, 'started');
    assert.equal(
      calls.find((c) => c.method === 'session/create')?.args.request.agentPreset,
      'haxor',
    );
    await launcher.launch(input, 'device');
    assert.equal(calls.filter((c) => c.method === 'session/create').length, 1);
    await assert.rejects(
      launcher.launch({ ...input, agentPreset: 'ash' }, 'device'),
      /different settings/,
    );
    const { agentPreset: _preset, ...defaultInput } = input;
    await launcher.launch({ ...defaultInput, requestId: randomUUID() }, 'device');
    assert.equal(
      calls.filter((c) => c.method === 'session/create').at(-1)?.args.request.agentPreset,
      undefined,
    );
  } finally {
    store.close();
  }
});

test('new project folders stay inside the permitted home and permission choices reject before launch', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'relay-project-'));
  const store = new Store(':memory:');
  const profile = launchProfileSchema.parse({
    id: 'claude',
    hostId: 'fred',
    label: 'Claude',
    harness: 'claude',
    workspaceId: 'w1',
    roots: [root],
    permissionPresets: [{ id: 'plan', name: 'Plan', args: ['--permission-mode', 'plan'] }],
  });
  const launcher = new Launcher(store, [profile], new Map());
  try {
    assert.equal(
      (await launcher.createFolder('claude', 'New project', 'device')).path,
      path.join(root, 'New project'),
    );
    for (const name of ['../escape', '/tmp/escape', '.ssh', 'nested/path', 'bad\\path'])
      await assert.rejects(launcher.createFolder('claude', name, 'device'), /project name/);
    await assert.rejects(
      launcher.createFolder('claude', 'New project', 'device'),
      /already exists/,
    );
    await symlink('/tmp', path.join(root, 'link'));
    await assert.rejects(launcher.createFolder('claude', 'link', 'device'), /already exists/);
    const input = {
      requestId: randomUUID(),
      profileId: 'claude',
      cwd: root,
      name: 'Test',
      model: '',
      prompt: 'Hello',
      permission: 'plan',
    };
    await assert.rejects(launcher.launch(input, 'device'), /confirm/);
    await assert.rejects(
      launcher.launch({ ...input, permission: 'invented', permissionConfirmed: true }, 'device'),
      /available/,
    );
    assert.equal(launcher.receipt(input.requestId), undefined);
    const [catalog] = await launcher.catalog();
    assert.deepEqual(catalog.permissions, [{ id: 'plan', name: 'Plan', description: '' }]);
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('DSH confirms launch permissions before sending the first instruction', async () => {
  const store = new Store(':memory:');
  const calls: string[] = [];
  let nativeId = '';
  let confirmed = true;
  const host: any = {
    connected: true,
    native: {
      call: async (method: string, args: any) => {
        calls.push(method);
        if (method === 'permissionPresets/catalog')
          return { options: [{ value: 'workspace', name: 'Workspace' }] };
        if (method === 'session/create') nativeId = args.request.sessionId;
        return { result: { kind: 'success' } };
      },
      list: async () => ({
        items: [
          {
            sessionId: nativeId,
            projections: {
              values: { permissions: { currentValue: confirmed ? 'workspace' : 'other' } },
            },
          },
        ],
      }),
      prompt: async () => {
        calls.push('prompt');
      },
    },
  };
  const profile = launchProfileSchema.parse({
    id: 'dsh',
    hostId: 'dsh',
    label: 'DSH',
    harness: 'dsh',
    workspaceId: 'w1',
    roots: [tmpdir()],
  });
  const launcher = new Launcher(store, [profile], new Map(), new Map(), new Map([['dsh', host]]));
  const input = {
    requestId: randomUUID(),
    profileId: 'dsh',
    cwd: tmpdir(),
    name: 'Project',
    model: '',
    prompt: 'Hello',
    permission: 'workspace',
    permissionConfirmed: true,
  };
  try {
    assert.equal((await launcher.launch(input, 'device')).status, 'started');
    assert.ok(calls.indexOf('commands/execute') < calls.indexOf('prompt'));
    calls.length = 0;
    confirmed = false;
    assert.equal(
      (await launcher.launch({ ...input, requestId: randomUUID() }, 'device')).status,
      'uncertain',
    );
    assert.ok(!calls.includes('prompt'));
  } finally {
    store.close();
  }
});

test('Claude CFR launches pin internal model aliases and the advertised context window', async () => {
  const server = createServer((_request, response) => {
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ data: [{ id: 'codex/gpt-test', context_window: 500000 }] }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  const store = new Store(':memory:');
  const profile = launchProfileSchema.parse({
    id: 'claude-cfrproxy',
    modelsEndpoint: `http://127.0.0.1:${address.port}/v1/models`,
    hostId: 'fred',
    label: 'Proxy',
    harness: 'claude',
    provider: 'CFRproxy',
    workspaceId: 'w1',
    roots: ['/tmp'],
    models: [{ id: 'codex/gpt-test', name: 'Test', contextWindow: 500000 }],
  });
  const launcher = new Launcher(store, [profile], new Map());
  try {
    const env = await launcher.launchEnvironment(profile, 'codex/gpt-test');
    for (const key of [
      'ANTHROPIC_MODEL',
      'ANTHROPIC_DEFAULT_MODEL',
      'ANTHROPIC_DEFAULT_FABLE_MODEL',
      'ANTHROPIC_SMALL_FAST_MODEL',
      'ANTHROPIC_DEFAULT_OPUS_MODEL',
      'ANTHROPIC_DEFAULT_SONNET_MODEL',
      'ANTHROPIC_DEFAULT_HAIKU_MODEL',
    ])
      assert.equal(env[key], 'codex/gpt-test');
    assert.equal(env.CLAUDE_CODE_MAX_CONTEXT_TOKENS, '500000');
    assert.equal(env.ANTHROPIC_CUSTOM_HEADERS, 'X-CFR-Model: codex/gpt-test');
    const unknown = await launcher.launchEnvironment(profile, 'custom/model');
    assert.equal(unknown.ANTHROPIC_MODEL, 'custom/model');
    assert.equal(unknown.CLAUDE_CODE_MAX_CONTEXT_TOKENS, undefined);
    assert.deepEqual(
      await launcher.launchEnvironment({ ...profile, provider: 'Harness default' }, 'native'),
      {},
    );
    assert.deepEqual(
      await launcher.launchEnvironment({ ...profile, harness: 'codex' }, 'native'),
      {},
    );
  } finally {
    store.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('Codex proxy context follows verified model metadata and leaves unknown/native models alone', async () => {
  const store = new Store(':memory:');
  const profile = launchProfileSchema.parse({
    id: 'proxy',
    hostId: 'host',
    label: 'Proxy',
    harness: 'codex',
    provider: 'CFRproxy',
    workspaceId: 'w1',
    roots: [tmpdir()],
    models: [{ id: 'command/model', name: 'Command', contextWindow: 1000000 }],
  });
  const launcher = new Launcher(store, [profile], new Map());
  try {
    assert.deepEqual(await launcher.codexConfiguration(profile, 'command/model'), {
      model_context_window: 1000000,
      model_auto_compact_token_limit: 950000,
    });
    assert.deepEqual(await launcher.codexConfiguration(profile, 'unknown'), {});
    assert.deepEqual(
      await launcher.codexConfiguration({ ...profile, provider: 'Codex account' }, 'command/model'),
      {},
    );
    assert.deepEqual(
      await launcher.codexConfiguration({ ...profile, harness: 'claude' }, 'command/model'),
      {},
    );
  } finally {
    store.close();
  }
});
