import test from 'node:test';
import assert from 'node:assert/strict';
import {
  startHarness,
  harnessReady,
  isClaudeSettingsWarning,
  HarnessStartupBlocked,
} from '../../../apps/gateway/src/start-harness.ts';

const settingsWarning =
  'Settings Warn\ning\nInvalid rule: *\n❯ 1. Continue\n2. Fix with Claude\n3. Exit and fix manually\nEnter to confirm';

test('Claude settings warnings stop startup without accepting a menu or leaking native output', async () => {
  assert.equal(isClaudeSettingsWarning(settingsWarning), true);
  assert.equal(isClaudeSettingsWarning('Allow Bash?\n❯ 1. Continue\nEnter to confirm'), false);
  const calls: string[] = [];
  const client = {
    request: async (method: string) => {
      calls.push(method);
      assert.equal(method, 'pane.read');
      return { read: { text: settingsWarning + '\nprivate-environment-value' } };
    },
  };
  await assert.rejects(
    harnessReady(client as any, {
      agent: 'claude',
      agent_status: 'blocked',
      interactive_ready: false,
      pane_id: 'pane',
    }),
    (error: unknown) =>
      error instanceof HarnessStartupBlocked && !error.message.includes('private-environment'),
  );
  assert.deepEqual(calls, ['pane.read']);
  calls.length = 0;
  assert.equal(
    await harnessReady(client as any, {
      agent: 'claude',
      agent_status: 'blocked',
      agent_session: { value: 'existing' },
      interactive_ready: false,
    }),
    false,
  );
  assert.deepEqual(calls, []);
});

test('CFR launch quotes all arguments and waits for harness detection before naming', async () => {
  const calls: any[] = [];
  const client = {
    request: async (method: string, params: any) => {
      calls.push({ method, params });
      if (method === 'pane.process_info')
        return {
          process_info: {
            shell_pid: 10,
            foreground_process_group_id: 10,
            foreground_processes: [{ pid: 10 }],
          },
        };
      if (method === 'agent.get') return { agent: { agent: 'claude' } };
      return {};
    },
  };
  await startHarness(client as any, 'CFRproxy', {
    name: 'test',
    kind: 'claude',
    pane_id: 'p1',
    args: ['--resume', 'uuid', '--settings', "a'b $(touch /tmp/never)"],
    timeout_ms: 1000,
  });
  assert.equal(
    calls[1].params.text,
    "'cfrproxy' 'claude' '--resume' 'uuid' '--settings' 'a'\\''b $(touch /tmp/never)'",
  );
  assert.deepEqual(calls[1].params.keys, ['enter']);
  assert.equal(calls[3].method, 'agent.rename');
});

test('CFR launch rejects a busy pane before any command is sent', async () => {
  const client = {
    request: async (method: string) => {
      assert.equal(method, 'pane.process_info');
      return {
        process_info: {
          shell_pid: 10,
          foreground_process_group_id: 20,
          foreground_processes: [{ pid: 20 }],
        },
      };
    },
  };
  await assert.rejects(
    startHarness(client as any, 'CFRproxy', {
      name: 't',
      kind: 'claude',
      pane_id: 'p',
      args: [],
      timeout_ms: 1000,
    }),
    /initializing/,
  );
});

test('narrow Claude panes require an empty prompt and stable native identity', async () => {
  const { harnessReady } = await import('../../../apps/gateway/src/start-harness.ts');
  const agent = {
    agent: 'claude',
    agent_session: { value: 'uuid' },
    agent_status: 'idle',
    terminal_id: 't',
    pane_id: 'p',
  };
  let screen = '────\n❯\n────';
  let fresh = agent;
  const c = {
    request: async (method: string) =>
      method === 'pane.read' ? { read: { text: screen } } : { agent: fresh },
  };
  assert.equal(await harnessReady(c as any, agent), true);
  screen = '────\n❯ Try "fix lint errors"\n────';
  assert.equal(await harnessReady(c as any, agent), true);
  screen = '❯ No, exit\nYes, trust this folder';
  assert.equal(await harnessReady(c as any, agent), false);
  screen = '❯';
  fresh = { ...agent, terminal_id: 'different' };
  assert.equal(await harnessReady(c as any, agent), false);
});
