import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { fixture } from './helpers.ts';
import { Launcher, launchProfileSchema } from '../../../apps/gateway/src/launch.ts';
import { ProviderSwaps } from '../../../apps/gateway/src/provider-swap.ts';

async function setup() {
  const f = await fixture({ harness: 'claude', startRuntime: false });
  const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
  await once(child, 'spawn');
  const session = f.session;
  session.nativeSessionId = randomUUID();
  f.mock.sessionId = session.nativeSessionId;
  session.cwd = f.dir;
  session.processIdentity = `123:${child.pid}`;
  session.status = 'idle';
  f.gateway.store.saveSession(session);
  const profile = launchProfileSchema.parse({
    id: 'claude-proxy',
    hostId: 'test',
    harness: 'claude',
    label: 'Claude CFRproxy',
    provider: 'CFRproxy',
    workspaceId: 'w1',
    roots: [f.dir],
    models: [{ id: 'proxy/model', name: 'Proxy Model' }],
    args: ['--settings', '{"env":{"ANTHROPIC_BASE_URL":"http://localhost:8420"}}'],
    permissionPresets: [{ id: 'ask', name: 'Ask', args: ['--permission-mode', 'default'] }],
  });
  f.config.launchProfiles = [profile];
  const client = f.gateway.runtime.clients.get('test')!;
  const calls: { method: string; params: any }[] = [];
  let owner = '';
  const runtime = f.gateway.runtime;
  runtime.assertBinding = async (s) => {
    assert.equal(s.generation, f.gateway.store.session(s.id).generation);
  };
  runtime.adapters.set(session.id, { turnState: async () => 'idle' } as any);
  client.snapshot = async () => ({ agents: [] }) as any;
  client.request = async (method, params: any) => {
    calls.push({ method, params });
    if (method === 'tab.create')
      return { root_pane: { pane_id: 'w1:p2', terminal_id: 'replacement' } };
    if (method === 'pane.close') {
      child.kill('SIGTERM');
      return { ok: true };
    }
    if (method === 'pane.get') return { pane: { terminal_id: 'replacement' } };
    if (method === 'pane.process_info')
      return {
        process_info: {
          shell_pid: 777,
          foreground_process_group_id: 777,
          foreground_processes: [{ pid: 777 }],
        },
      };
    if (method === 'pane.send_input') {
      assert.throws(() => process.kill(child.pid!, 0));
      assert.ok(params.text.startsWith("'cfrproxy' 'claude'"));
      return {};
    }
    if (method === 'agent.rename') {
      owner = params.name;
      return {};
    }
    if (method === 'agent.start') {
      assert.throws(() => process.kill(child.pid!, 0));
      owner = params.name;
      return { ok: true };
    }
    if (method === 'agent.get')
      return {
        agent: {
          terminal_id: 'replacement',
          name: owner,
          agent: 'claude',
          agent_session: { value: session.nativeSessionId },
          interactive_ready: true,
        },
      };
    throw new Error('Unexpected method ' + method);
  };
  runtime.refresh = async () => {
    f.gateway.store.saveSession({
      ...session,
      terminalId: 'replacement',
      paneId: 'w1:p2',
      generation: 'resumed-owner',
      queuePaused: true,
    });
  };
  const launcher = new Launcher(f.gateway.store, [profile], runtime.clients);
  const swaps = new ProviderSwaps(runtime, launcher);
  const input = {
    requestId: randomUUID(),
    generation: session.generation,
    profileId: profile.id,
    model: 'proxy/model',
    permission: 'ask',
    confirm: true as const,
  };
  return {
    ...f,
    session,
    swaps,
    input,
    calls,
    client,
    child,
    close: async () => {
      child.kill();
      await f.close();
    },
  };
}
test('provider swap closes the verified old owner before exact resume, preserves CWD, pauses queue and deduplicates', async () => {
  const f = await setup();
  try {
    assert.equal((await f.swaps.catalog(f.session.id)).currentProvider, undefined);
    const receipt = await f.swaps.restart(f.session.id, f.input, 'device');
    assert.equal((await f.swaps.catalog(f.session.id)).currentProvider, 'CFRproxy');
    assert.equal(receipt.status, 'started');
    assert.ok(
      f.calls.findIndex((c) => c.method === 'pane.close') <
        f.calls.findIndex((c) => c.method === 'pane.send_input'),
    );
    const start = f.calls.find((c) => c.method === 'pane.send_input')!;
    assert.ok(start.params.text.includes(`'--resume' '${f.session.nativeSessionId}'`));
    assert.ok(start.params.text.includes("'--permission-mode' 'default' '--model' 'proxy/model'"));
    assert.deepEqual(start.params.keys, ['enter']);
    assert.equal(f.calls.find((c) => c.method === 'tab.create')!.params.cwd, f.session.cwd);
    assert.equal(
      f.calls.find((c) => c.method === 'tab.create')!.params.env.ANTHROPIC_SMALL_FAST_MODEL,
      'proxy/model',
    );
    assert.equal(
      f.calls.find((c) => c.method === 'tab.create')!.params.env.ANTHROPIC_MODEL,
      'proxy/model',
    );
    assert.equal(f.gateway.store.session(f.session.id).queuePaused, true);
    const count = f.calls.length;
    assert.deepEqual(await f.swaps.restart(f.session.id, f.input, 'device'), receipt);
    assert.equal(f.calls.length, count);
    await assert.rejects(
      f.swaps.restart(f.session.id, { ...f.input, model: 'another' }, 'device'),
      /different settings/,
    );
    f.gateway.store.saveSession({
      ...f.gateway.store.session(f.session.id),
      terminalId: 'unrelated-owner',
    });
    assert.equal((await f.swaps.catalog(f.session.id)).currentProvider, undefined);
  } finally {
    await f.close();
  }
});
test('invalid owner, model, permissions, host or busy state never closes a pane', async () => {
  const f = await setup();
  try {
    for (const patch of [
      { generation: 'stale' },
      { model: 'bad;command' },
      { permission: undefined },
      { profileId: 'another-host' },
    ])
      await assert.rejects(f.swaps.restart(f.session.id, { ...f.input, ...patch }, 'device'));
    f.gateway.runtime.adapters.set(f.session.id, { turnState: async () => 'working' } as any);
    await assert.rejects(f.swaps.restart(f.session.id, f.input, 'device'), /Finish or stop/);
    assert.equal(f.calls.length, 0);
    assert.equal(f.swaps.receipt(f.input.requestId), undefined);
  } finally {
    await f.close();
  }
});
test('ambiguous start persists uncertainty across restart without starting another writer', async () => {
  const f = await setup();
  try {
    const original = f.client.request.bind(f.client);
    f.client.request = async (method, params) => {
      if (method === 'pane.send_input') throw new Error('Lost confirmation');
      return original(method, params);
    };
    const receipt = await f.swaps.restart(f.session.id, f.input, 'device');
    assert.equal(receipt.status, 'uncertain');
    assert.equal(f.gateway.store.session(f.session.id).queuePaused, true);
    const n = f.calls.length;
    assert.deepEqual(await f.swaps.restart(f.session.id, f.input, 'device'), receipt);
    assert.equal(f.calls.length, n);
    const recovered = new ProviderSwaps(
      f.gateway.runtime,
      new Launcher(f.gateway.store, f.config.launchProfiles, f.gateway.runtime.clients),
    );
    assert.equal(recovered.receipt(f.input.requestId)?.status, 'uncertain');
    assert.equal(f.calls.length, n);
  } finally {
    await f.close();
  }
});

test('receipt checks reconcile an exact late native binding without sending input or launching again', async () => {
  const f = await setup();
  try {
    const receipt = await f.swaps.restart(f.session.id, f.input, 'device');
    receipt.status = 'uncertain';
    receipt.phase = 'confirm';
    f.gateway.store.db
      .prepare('UPDATE provider_swaps SET receipt=? WHERE id=?')
      .run(JSON.stringify(receipt), f.input.requestId);
    const offset = f.calls.length;
    assert.equal((await f.swaps.inspect(f.input.requestId))?.status, 'started');
    assert.deepEqual(
      f.calls.slice(offset).map((c) => c.method),
      ['agent.get'],
    );
    assert.equal(f.swaps.receipt(f.input.requestId)?.status, 'started');
    assert.equal(f.gateway.store.session(f.session.id).model, f.input.model);
    f.gateway.store.event(f.gateway.store.session(f.session.id), {
      sourceId: 'old-model',
      kind: 'assistant.message',
      timestamp: '2020-01-01T00:00:00Z',
      data: { text: 'Old reply', model: 'old-opus' },
    });
    assert.equal(f.gateway.store.session(f.session.id).model, f.input.model);
  } finally {
    await f.close();
  }
});

test('Codex provider restart unloads the exact native thread and restores idle descendants before provider override', async () => {
  const { resumeCodexProvider } =
    await import('../../../apps/gateway/src/codex-provider-resume.ts');
  const root = randomUUID(),
    child = randomUUID();
  const archived = new Set<string>();
  let loaded = true;
  const calls: string[] = [];
  let recorded = false;
  const native = {
    request: async (method: string, p: any) => {
      calls.push(method + ':' + (p.threadId ?? 'list'));
      if (method === 'thread/read') return { thread: { id: p.threadId, status: { type: 'idle' } } };
      if (method === 'thread/list')
        return {
          data: p.archived
            ? [...archived].filter((id) => id !== root).map((id) => ({ id }))
            : [{ id: child, status: { type: 'notLoaded' } }],
          nextCursor: null,
        };
      if (method === 'thread/archive') {
        assert.equal(recorded, true);
        archived.add(root);
        archived.add(child);
        loaded = false;
        return {};
      }
      if (method === 'thread/loaded/list') return { data: loaded ? [root] : [] };
      if (method === 'thread/unarchive') {
        archived.delete(p.threadId);
        return { thread: { id: p.threadId } };
      }
      if (method === 'thread/resume') {
        assert.equal(loaded, false);
        assert.equal(archived.size, 0);
        return { thread: { id: root }, model: p.model, modelProvider: p.modelProvider };
      }
      throw new Error(method);
    },
  };
  const result = await resumeCodexProvider(
    native as any,
    root,
    { model: 'proxy-model', modelProvider: 'local_models' },
    (ids) => {
      assert.deepEqual(ids, [child]);
      recorded = true;
    },
  );
  assert.equal(result.modelProvider, 'local_models');
  assert.equal(result.thread.id, root);
  assert.ok(calls.indexOf('thread/unarchive:' + child) < calls.indexOf('thread/resume:' + root));
});
test('native child work prevents archival and an archive acknowledgement loss still attempts history restoration', async () => {
  const { resumeCodexProvider } =
    await import('../../../apps/gateway/src/codex-provider-resume.ts');
  const root = randomUUID(),
    child = randomUUID();
  let active = true;
  let archives = 0,
    restores = 0;
  const native = {
    request: async (method: string, p: any) => {
      if (method === 'thread/read') return { thread: { id: root, status: { type: 'idle' } } };
      if (method === 'thread/list')
        return {
          data: !p.archived ? [{ id: child, status: { type: active ? 'active' : 'idle' } }] : [],
          nextCursor: null,
        };
      if (method === 'thread/archive') {
        archives++;
        throw new Error('Lost native acknowledgement');
      }
      if (method === 'thread/unarchive') {
        restores++;
        return { thread: { id: root } };
      }
      throw new Error(method);
    },
  };
  await assert.rejects(resumeCodexProvider(native as any, root, {}), /active sub-agents/);
  assert.equal(archives, 0);
  active = false;
  await assert.rejects(resumeCodexProvider(native as any, root, {}), /Lost native/);
  assert.equal(archives, 1);
  assert.equal(restores, 1);
});
