import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { configSchema } from '../../../apps/gateway/src/config.ts';
test('installer config is host-neutral, schema-valid and connects both launch profiles to the local proxy', () => {
  const result = JSON.parse(
    execFileSync(
      process.execPath,
      [
        '--import',
        'tsx',
        'scripts/render-install-config.ts',
        '--socket',
        '/run/example/herdr.sock',
        '--workspace',
        'w-new',
        '--origin',
        'https://relay.example.test',
        '--tailnet-origin',
        'https://agentbox.tail-example.ts.net:11543',
      ],
      { encoding: 'utf8' },
    ),
  );
  const config = configSchema.parse(result);
  assert.equal(config.hosts[0].id, 'local');
  assert.equal(config.hosts[0].socket, '/run/example/herdr.sock');
  assert.equal(config.dataDir, `${homedir()}/.local/state/relay`);
  assert.equal(config.tailnet?.port, 4081);
  assert.equal(config.launchProfiles[0].environment.ANTHROPIC_BASE_URL, 'RELAY_CFR_ANTHROPIC_URL');
  assert.equal(config.launchProfiles[1].codexProvider, 'cfrproxy');
  assert.equal(JSON.stringify(result).includes('fred.taile'), false);
});
test('installer rejects insecure origins and missing authoritative socket/workspace inputs', () => {
  const invoke = (args: string[]) =>
    spawnSync(process.execPath, ['--import', 'tsx', 'scripts/render-install-config.ts', ...args], {
      encoding: 'utf8',
    });
  assert.notEqual(invoke([]).status, 0);
  assert.notEqual(
    invoke([
      '--socket',
      '/run/herdr.sock',
      '--workspace',
      'w1',
      '--origin',
      'http://relay.example.test',
      '--tailnet-origin',
      'https://agentbox.ts.net:11543',
    ]).status,
    0,
  );
});
