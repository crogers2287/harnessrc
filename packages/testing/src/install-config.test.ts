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
  const permissions = config.launchProfiles[0].permissionPresets;
  assert.equal(permissions[0].id, 'default');
  assert.deepEqual(permissions.find((p) => p.id === 'bypass')?.args, [
    '--dangerously-skip-permissions',
  ]);
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

test('existing-install Claude bypass upgrade preserves custom presets, defaults and other harnesses', async () => {
  const { mkdtemp, writeFile, readFile, readdir, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = await mkdtemp(join(tmpdir(), 'relay-bypass-upgrade-'));
  const configPath = join(dir, 'config.json');
  const original = {
    launchProfiles: [
      {
        id: 'custom-claude',
        harness: 'claude',
        defaultModel: 'my/model',
        permissionPresets: [
          { id: 'custom', name: 'Custom', args: ['--permission-mode', 'default'] },
        ],
      },
      { id: 'codex', harness: 'codex', permissionPresets: [] },
    ],
    unrelated: { keep: true },
  };
  try {
    await writeFile(configPath, JSON.stringify(original));
    const run = () =>
      execFileSync('python3', [
        'scripts/configure-launch-permissions.py',
        '--claude-bypass-only',
        '--config',
        configPath,
      ]);
    run();
    const saved = JSON.parse(await readFile(configPath, 'utf8'));
    assert.deepEqual(
      saved.launchProfiles[0].permissionPresets[0],
      original.launchProfiles[0].permissionPresets[0],
    );
    assert.equal(saved.launchProfiles[0].defaultModel, 'my/model');
    assert.deepEqual(saved.launchProfiles[1], original.launchProfiles[1]);
    assert.deepEqual(saved.unrelated, original.unrelated);
    assert.deepEqual(saved.launchProfiles[0].permissionPresets[1].args, [
      '--dangerously-skip-permissions',
    ]);
    run();
    assert.equal(
      JSON.parse(await readFile(configPath, 'utf8')).launchProfiles[0].permissionPresets.length,
      2,
    );
    assert.ok((await readdir(dir)).some((name) => name.includes('before-launch-permissions')));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
