import test from 'node:test';
import assert from 'node:assert/strict';
import {
  acceptClaudeResumeTrust,
  isClaudeFolderTrust,
} from '../../../apps/gateway/src/claude-resume-trust.ts';

const visible = '❯ No,\n exit\n Yes, I\n trust this fold\n Enter to con\nfirm · Esc to cancel';
const recent =
  'Accessing worksp\nace: /projects/\nexample\nQuick safety check: Is this a proje\nct you creat\ned or one you trust?';
test('Claude bootstrap matcher joins narrow terminal wrapping but rejects other folders and menus', () => {
  assert.ok(isClaudeFolderTrust(visible, recent, '/projects/example'));
  assert.ok(!isClaudeFolderTrust(visible, recent, '/projects/another'));
  assert.ok(!isClaudeFolderTrust('Allow Bash? Yes No', recent, '/projects/example'));
  assert.ok(!isClaudeFolderTrust(visible.replace('❯ No,', 'No,'), recent, '/projects/example'));
});
test('startup continuation requires the exact live Herdr owner and sends only fixed native keys', async () => {
  for (const changed of [false, true]) {
    const sent: unknown[] = [];
    let reads = 0;
    const client = {
      request: async (method: string, params: any) => {
        if (method === 'agent.get')
          return {
            agent: {
              terminal_id: 'term',
              name: 'owned',
              agent: 'claude',
              foreground_cwd: '/projects/example',
            },
          };
        if (method === 'pane.process_info')
          return {
            process_info: {
              shell_pid: 100,
              foreground_process_group_id: changed && reads ? 202 : 201,
            },
          };
        if (method === 'pane.read') {
          reads++;
          return { read: { text: params.source === 'visible' ? visible : recent } };
        }
        if (method === 'agent.send_keys') {
          sent.push(params);
          return {};
        }
        throw new Error(method);
      },
    };
    assert.equal(
      await acceptClaudeResumeTrust(client as any, 'pane', 'term', 'owned', '/projects/example'),
      !changed,
    );
    assert.deepEqual(sent, changed ? [] : [{ target: 'pane', keys: ['down', 'enter'] }]);
  }
});
