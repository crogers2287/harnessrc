import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { dshTerminalOutput } from '../../../apps/gateway/src/dsh-terminal.ts';
// @ts-expect-error Cordis loads this dependency-free host plugin as JavaScript.
import { apply, terminalSnapshot } from '../../../integrations/dsh-terminal.mjs';

test('native terminal observer reads only the exact live owner and never sends input', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'relay-terminal-'));
  let dispose: (() => void) | undefined;
  const owner = {
    session: { id: 'own-session' },
    ctx: {
      terminals: {
        list(agent: unknown) {
          assert.equal(agent, owner);
          return [{ sessionId: 'owned-pty' }];
        },
        read(agent: unknown, id: string) {
          assert.equal(agent, owner);
          assert.equal(id, 'owned-pty');
          return {
            text: '\u001b[31mAre you sure you want to continue connecting (yes/no/[fingerprint])?\u001b[0m',
          };
        },
        startSend() {
          assert.fail('read endpoint must never send input');
        },
      },
    },
  };
  const ctx = {
    agents: new Map([['own-session', owner]]),
    on(_event: string, callback: () => void) {
      dispose = callback;
    },
  };
  try {
    const socket = path.join(dir, 'terminal.sock');
    await apply(ctx, { socket });
    assert.match(await dshTerminalOutput(socket, 'own-session'), /^Are you sure/);
    assert.equal(await dshTerminalOutput(socket, 'another-session'), '');
    assert.throws(() => terminalSnapshot(ctx, 'another-session'), /live session owner/);
    assert.equal(await dshTerminalOutput(path.join(dir, 'missing.sock'), 'own-session'), '');
    const response = await new Promise<string>((resolve) => {
      const c = net.createConnection(socket);
      let value = '';
      c.on('connect', () => c.write('{"method":"send","sessionId":"own-session","text":"yes"}\n'));
      c.on('data', (b) => (value += b.toString()));
      c.on('end', () => resolve(value));
    });
    assert.match(response, /unavailable/);
  } finally {
    dispose?.();
    await rm(dir, { recursive: true, force: true });
  }
});
