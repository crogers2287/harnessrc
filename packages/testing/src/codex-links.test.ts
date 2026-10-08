import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '@harnessrc/storage';
import { HerdrClient, sessionFromAgent, type Agent } from '@harnessrc/herdr';
import { CodexLinks } from '../../../apps/gateway/src/codex-links.ts';

function fixture() {
  const store = new Store(':memory:');
  const names = new Map([
    ['thread-a', 'Shared name'],
    ['thread-b', 'Shared name'],
  ]);
  let active = 'thread-b';
  let pid = 12;
  let registered: string | undefined;
  let duplicate = false;
  let echo = true;
  let replaceOnProbe = false;
  let concurrentName: string | undefined;
  const writes: string[] = [];
  const agent = (): Agent => ({
    agent: 'codex',
    terminal_id: 'term',
    pane_id: 'w1:p1',
    workspace_id: 'w1',
    agent_status: 'idle',
    terminal_title_stripped: `${echo ? names.get(active) : 'Shared name'} | project`,
    agent_session: registered
      ? { agent: 'codex', kind: 'id', value: registered, source: 'herdr:codex' }
      : null,
  });
  const client = new HerdrClient('test', '/unused');
  client.request = async (method, params: any) => {
    if (method === 'agent.get') return { agent: agent() };
    if (method === 'pane.process_info')
      return {
        process_info: {
          shell_pid: 10,
          foreground_process_group_id: pid,
          foreground_processes: [{ name: 'codex', pid }],
        },
      };
    if (method === 'pane.report_agent_session') {
      registered = params.agent_session_id;
      return {};
    }
    throw new Error(method);
  };
  client.snapshot = async () => ({
    agents: [agent(), ...(duplicate ? [{ ...agent(), terminal_id: 'other' }] : [])],
    workspaces: [],
    tabs: [],
    panes: [],
  });
  const native = {
    request: async (method: string, p: any) => {
      if (method === 'thread/loaded/list') return { data: [...names.keys()], nextCursor: null };
      if (method === 'thread/read')
        return { thread: { id: p.threadId, name: names.get(p.threadId) } };
      if (method === 'thread/name/set') {
        writes.push(p.name);
        names.set(p.threadId, p.name);
        if (p.name.startsWith('Relay link ')) {
          if (replaceOnProbe) pid++;
          if (concurrentName) names.set(p.threadId, concurrentName);
        }
        return {};
      }
      throw new Error(method);
    },
  };
  const links = new CodexLinks('test', store, native);
  return {
    store,
    client,
    agent,
    names,
    writes,
    native,
    links,
    switch: (id: string) => {
      active = id;
    },
    duplicate: () => {
      duplicate = true;
    },
    noEcho: () => {
      echo = false;
    },
    replace: () => {
      replaceOnProbe = true;
    },
    rename: (value: string) => {
      concurrentName = value;
    },
  };
}

test('native nonce selects the correct same-name thread, restores names, and registers the existing terminal', async () => {
  const f = fixture();
  try {
    const [agent] = await f.links.refresh(f.client, [f.agent()]);
    assert.equal(agent.agent_session?.value, 'thread-b');
    assert.equal(f.names.get('thread-a'), 'Shared name');
    assert.equal(f.names.get('thread-b'), 'Shared name');
    assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM codex_name_probes').get()!.n, 0);
    assert.ok(f.writes.some((s) => s.startsWith('Relay link ')));
  } finally {
    f.store.close();
  }
});

test('fresh delivery verification rejects a terminal switched to another identically named thread', async () => {
  const f = fixture();
  try {
    const [agent] = await f.links.refresh(f.client, [f.agent()]);
    const session = sessionFromAgent('test', agent, 'project');
    session.processIdentity = '10:12';
    f.switch('thread-a');
    await assert.rejects(f.links.assertDelivery(f.client, session), /did not confirm/);
    const [next] = await f.links.refresh(f.client, [f.agent()]);
    assert.equal(next.agent_session, null);
  } finally {
    f.store.close();
  }
});

test('missing nonce echo, duplicate terminals, and replacement processes never receive control', async () => {
  for (const setup of ['noEcho', 'duplicate', 'replace'] as const) {
    const f = fixture();
    try {
      f[setup]();
      const [agent] = await f.links.refresh(f.client, [f.agent()]);
      assert.equal(agent.agent_session, null);
      assert.equal(f.names.get('thread-a'), 'Shared name');
      assert.equal(f.names.get('thread-b'), 'Shared name');
    } finally {
      f.store.close();
    }
  }
});

test('restart recovers an interrupted title probe without overwriting a concurrent native rename', async () => {
  const f = fixture();
  try {
    f.store.db
      .prepare('INSERT INTO codex_name_probes VALUES(?,?,?,?)')
      .run('test', 'thread-a', 'Original', 'Relay link interrupted');
    f.names.set('thread-a', 'Relay link interrupted');
    await f.links.refresh(f.client, []);
    assert.equal(f.names.get('thread-a'), 'Original');
    f.store.db
      .prepare('INSERT INTO codex_name_probes VALUES(?,?,?,?)')
      .run('test', 'thread-a', 'Original', 'Relay link interrupted');
    f.names.set('thread-a', 'Renamed by user');
    const restarted = new CodexLinks('test', f.store, f.native);
    await restarted.refresh(f.client, []);
    assert.equal(f.names.get('thread-a'), 'Renamed by user');
  } finally {
    f.store.close();
  }
});

test('a daemon outage disables only its managed links, preserving independent native bridges', async () => {
  const f = fixture();
  try {
    const [managed] = await f.links.refresh(f.client, [f.agent()]);
    const bridge = { ...managed, terminal_id: 'independent-bridge' };
    const result = f.links.unavailable([managed, bridge]);
    assert.equal(result[0].agent_session, null);
    assert.deepEqual(result[1].agent_session, bridge.agent_session);
  } finally {
    f.store.close();
  }
});

test('steer targets the proved native active turn and never falls back to a new turn', async () => {
  const f = fixture();
  try {
    const [agent] = await f.links.refresh(f.client, [f.agent()]);
    const session = sessionFromAgent('test', agent, 'Project');
    session.processIdentity = '10:12';
    const original = f.native.request;
    const steers: any[] = [];
    let active = true;
    f.native.request = async (method, params) => {
      if (method === 'thread/turns/list')
        return { data: active ? [{ id: 'turn-current', status: 'inProgress' }] : [] } as any;
      if (method === 'turn/steer') {
        steers.push(params);
        return {};
      }
      return original(method, params);
    };
    await f.links.steer(f.client, session, 'Also check mobile');
    assert.equal(steers.length, 1);
    assert.equal(steers[0].threadId, 'thread-b');
    assert.equal(steers[0].expectedTurnId, 'turn-current');
    active = false;
    await assert.rejects(() => f.links.steer(f.client, session, 'Too late'), /no longer working/);
    assert.equal(steers.length, 1);
  } finally {
    f.store.close();
  }
});
