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
  let titlePrefix = '';
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
    terminal_title_stripped: `${titlePrefix}${echo ? names.get(active) : 'Shared name'} | project`,
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
    register: (id: string) => {
      registered = id;
    },
    attention: (enabled: boolean | 'blink') => {
      titlePrefix =
        enabled === 'blink'
          ? '[ . ] Action Required | '
          : enabled
            ? '[ ! ] Action Required | '
            : '';
    },
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
    assert.equal(await f.links.turnState(f.client, session), 'working');
    await f.links.steer(f.client, session, 'Also check mobile', ['/uploads/screenshot.png']);
    assert.equal(steers.length, 1);
    assert.equal(steers[0].threadId, 'thread-b');
    assert.equal(steers[0].expectedTurnId, 'turn-current');
    assert.deepEqual(steers[0].input[1], { type: 'localImage', path: '/uploads/screenshot.png' });
    active = false;
    assert.equal(await f.links.turnState(f.client, session), 'idle');
    await assert.rejects(() => f.links.steer(f.client, session, 'Too late'), /no longer working/);
    assert.equal(steers.length, 1);
  } finally {
    f.store.close();
  }
});

test('refresh ignores an invalidation snapshot captured during a temporary native name proof', async () => {
  const f = fixture();
  try {
    await f.links.refresh(f.client, [f.agent()]);
    const stale = { ...f.agent(), terminal_title_stripped: 'Relay link stale-snapshot' };
    const current = await f.links.refresh(f.client, [stale]);
    assert.equal(current[0].agent_session?.value, 'thread-b');
  } finally {
    f.store.db.close();
  }
});

test('periodic verification proves the known owner without scanning unrelated loaded threads', async () => {
  const f = fixture();
  try {
    await f.links.refresh(f.client, [f.agent()]);
    const row = f.store.db.prepare('SELECT body FROM codex_terminal_links').get()!;
    const link = JSON.parse(row.body as string);
    link.verifiedAt = 0;
    f.store.db.prepare('UPDATE codex_terminal_links SET body=?').run(JSON.stringify(link));
    const original = f.native.request;
    let scans = 0;
    f.native.request = async (method, params) => {
      if (method === 'thread/loaded/list') scans++;
      return original(method, params);
    };
    const before = f.writes.length;
    const current = await f.links.refresh(f.client, [f.agent()]);
    assert.equal(current[0].agent_session?.value, 'thread-b');
    assert.ok(f.writes.length > before, 'fresh nonce proof still occurs');
    assert.equal(scans, 0);
  } finally {
    f.store.close();
  }
});

test('Codex action-required decoration preserves and recovers the proved native binding', async () => {
  const f = fixture();
  try {
    f.attention(true);
    const [initial] = await f.links.refresh(f.client, [f.agent()]);
    assert.equal(initial.agent_session?.value, 'thread-b');
    const session = sessionFromAgent('test', initial, 'project');
    session.processIdentity = '10:12';
    await f.links.assertDelivery(f.client, session);
    f.attention('blink');
    await f.links.assertDelivery(f.client, session);
    f.attention(false);
    const [normal] = await f.links.refresh(f.client, [f.agent()]);
    assert.equal(normal.agent_session?.value, 'thread-b');
    f.attention(true);
    const [waiting] = await f.links.refresh(f.client, [f.agent()]);
    assert.equal(waiting.agent_session?.value, 'thread-b');
    f.switch('thread-a');
    await assert.rejects(f.links.assertDelivery(f.client, session), /did not confirm/);
  } finally {
    f.store.close();
  }
});

test('interrupt targets only the proved active Codex turn and rejects idle or replaced owners', async () => {
  const f = fixture();
  try {
    const [agent] = await f.links.refresh(f.client, [f.agent()]);
    const session = sessionFromAgent('test', agent, 'Project');
    session.processIdentity = '10:12';
    const original = f.native.request;
    const stops: any[] = [];
    let active = true;
    f.native.request = async (method, params) => {
      if (method === 'thread/turns/list')
        return { data: active ? [{ id: 'turn-current', status: 'inProgress' }] : [] } as any;
      if (method === 'turn/interrupt') {
        stops.push(params);
        return {};
      }
      return original(method, params);
    };
    await f.links.interrupt(f.client, session);
    assert.deepEqual(stops, [{ threadId: 'thread-b', turnId: 'turn-current' }]);
    active = false;
    await assert.rejects(f.links.interrupt(f.client, session), /no active turn/);
    active = true;
    f.replace();
    await assert.rejects(f.links.interrupt(f.client, session), /process|replaced|confirm/);
    assert.equal(stops.length, 1);
  } finally {
    f.store.close();
  }
});

test('a CLI-reported native ID still receives a verified control link', async () => {
  const f = fixture();
  try {
    f.register('thread-b');
    await f.links.refresh(f.client, [f.agent()]);
    const session = sessionFromAgent('test', f.agent(), 'Project');
    session.processIdentity = '10:12';
    assert.equal(f.links.hasLink(session), true);
    assert.ok(f.writes.some((name) => name.startsWith('Relay link ')));
  } finally {
    f.store.close();
  }
});
