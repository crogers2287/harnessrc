import test from 'node:test';
import assert from 'node:assert/strict';
import { startHarness } from '../../../apps/gateway/src/start-harness.ts';

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
