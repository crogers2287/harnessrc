import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { bridgeRequest } from '@harnessrc/adapters';
import { eventually } from './helpers.ts';
import { MockHarness } from './mock.ts';
test('sole-writer Codex bridge uses native turn, streaming, approval response, and task correlation', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'native-'));
  const herdr = new MockHarness();
  await herdr.listen(path.join(dir, 'herdr.sock'), path.join(dir, 'mock.sock'));
  const binary = path.join(dir, 'codex-fixture');
  await writeFile(
    binary,
    `#!/bin/sh\nexec '${process.execPath}' --import tsx '${path.resolve('packages/testing/src/fake-codex.ts')}'\n`,
    { mode: 0o700 },
  );
  const child = spawn(process.execPath, ['--import', 'tsx', 'scripts/codex-bridge.ts'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      RC_BRIDGE_DIR: dir,
      RC_CODEX_BINARY: binary,
      RC_CODEX_SCHEMA_DIR: path.resolve('packages/testing/fixtures/codex-0.161.0'),
      HERDR_SOCKET_PATH: path.join(dir, 'herdr.sock'),
      HERDR_PANE_ID: herdr.paneId,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const exited = new Promise((resolve) => child.once('exit', resolve));
  let errors = '';
  child.stderr.on('data', (c) => (errors += c));
  const socket = path.join(dir, 'native.sock');
  const call = (method: string, params: Record<string, unknown> = {}) =>
    bridgeRequest(socket, method, { sessionId: 'native-fixture', ...params });
  try {
    await eventually(async () => {
      try {
        return (await call('snapshot')).sessionId === 'native-fixture';
      } catch {
        return false;
      }
    });
    assert.equal(
      herdr.sessionId,
      'native-fixture',
      'native bridge must bind its session through an accepted Herdr integration source',
    );
    const taskId = randomUUID();
    const sent = await call('send', { taskId, prompt: 'Test approvals' });
    assert.equal(sent.correlation, 'turn-1');
    assert.equal((await call('send', { taskId, prompt: 'Test approvals' })).correlation, 'turn-1');
    await eventually(async () => (await call('snapshot')).interactions.length === 1);
    const snapshot = await call('snapshot');
    assert.equal(snapshot.events.filter((e: any) => e.kind === 'turn.started').length, 1);
    assert.equal(snapshot.interactions[0].nativeRequestId, '42');
    await assert.rejects(() => call('respond', { nativeRequestId: 'wrong', response: 'accept' }));
    await call('respond', { nativeRequestId: '42', response: 'accept' });
    await eventually(async () => (await call('task', { taskId })).status === 'completed');
    assert.equal(
      (await call('snapshot')).events.filter((e: any) => e.kind === 'assistant.message').length,
      1,
    );
    await assert.rejects(() =>
      call('send', { sessionId: 'another', taskId: randomUUID(), prompt: 'Wrong session' }),
    );
  } catch (e) {
    throw new Error(`${(e as Error).message}\n${errors}`);
  } finally {
    child.kill('SIGTERM');
    await exited;
    await herdr.close();
    await rm(dir, { recursive: true, force: true });
  }
});
