import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fixture, eventually } from './helpers.ts';
import { hash } from '../../../apps/gateway/src/auth.ts';
import { spawn } from 'node:child_process';
import WebSocket from 'ws';
import path from 'node:path';
test('API rejects unauthenticated, cross-origin, and CSRF control requests', async () => {
  const f = await fixture({ startRuntime: false });
  try {
    assert.equal((await f.gateway.app.inject('/api/sessions')).statusCode, 401);
    assert.equal(
      (
        await f.gateway.app.inject({
          method: 'POST',
          url: `/api/sessions/${f.session.id}/tasks`,
          headers: { cookie: f.headers.cookie },
          payload: { prompt: 'No', idempotencyKey: randomUUID() },
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await f.gateway.app.inject({
          method: 'POST',
          url: `/api/sessions/${f.session.id}/tasks`,
          headers: { ...f.headers, origin: 'https://evil.invalid' },
          payload: { prompt: 'No', idempotencyKey: randomUUID() },
        })
      ).statusCode,
      403,
    );
    assert.equal(f.mock.prompts.length, 0);
  } finally {
    await f.close();
  }
});
test('device registration is one-use, grants separate reading from control, revocation is immediate', async () => {
  const f = await fixture({ startRuntime: false });
  try {
    const { auth, app, store } = f.gateway;
    const admin = auth.authenticate(f.headers.cookie.split('=')[1]);
    assert.throws(() => auth.pair(auth.pairingKey, 'Another admin'));
    const code = auth.pairCode(admin);
    const tokens = auth.pair(code, 'Phone');
    assert.throws(() => auth.pair(code, 'Repeated'));
    const phone = auth.authenticate(tokens.access);
    assert.equal(phone.admin, 0);
    const headers = { ...f.headers, cookie: `rc_access=${tokens.access}` };
    assert.equal(
      (await app.inject({ url: `/api/sessions/${f.session.id}`, headers })).statusCode,
      403,
    );
    auth.grant(admin, phone.id, f.session.id, false);
    assert.equal(
      (await app.inject({ url: `/api/sessions/${f.session.id}`, headers })).statusCode,
      200,
    );
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: `/api/sessions/${f.session.id}/tasks`,
          headers,
          payload: { prompt: 'No', idempotencyKey: randomUUID() },
        })
      ).statusCode,
      403,
    );
    auth.grant(admin, phone.id, f.session.id, true);
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: `/api/sessions/${f.session.id}/tasks`,
          headers,
          payload: { prompt: 'Authorized', idempotencyKey: randomUUID() },
        })
      ).statusCode,
      200,
    );
    auth.revoke(admin, phone.id);
    assert.throws(() => auth.authenticate(tokens.access));
    assert.ok(store.db.prepare('SELECT sequence FROM audit WHERE action=?').get('device.revoked'));
  } finally {
    await f.close();
  }
});
test('access expiration and refresh rotation reject replayed credentials', async () => {
  const f = await fixture({ startRuntime: false });
  try {
    const { auth, store } = f.gateway;
    const device = auth.authenticate(f.headers.cookie.split('=')[1]);
    const tokens = auth.issue(device.id);
    store.db.prepare('UPDATE tokens SET expires=0 WHERE hash=?').run(hash(tokens.access));
    assert.throws(() => auth.authenticate(tokens.access));
    const rotated = auth.refresh(tokens.refresh);
    assert.ok(auth.authenticate(rotated.access));
    assert.throws(() => auth.refresh(tokens.refresh));
  } finally {
    await f.close();
  }
});
test('WebSocket requires matching origin and revocation closes an existing connection', async () => {
  const f = await fixture({ startRuntime: false });
  try {
    const address = await f.gateway.app.listen({ host: '127.0.0.1', port: 0 });
    const socket = new WebSocket(address.replace('http', 'ws') + '/ws', {
      headers: { cookie: f.headers.cookie, origin: f.config.origin },
    });
    await new Promise<void>((resolve, reject) => {
      socket.once('open', () => resolve());
      socket.once('error', reject);
    });
    const closed = new Promise<void>((resolve) => socket.once('close', () => resolve()));
    const device = f.gateway.auth.authenticate(f.headers.cookie.split('=')[1]);
    f.gateway.auth.revoke(device, device.id);
    f.gateway.store.emit('change');
    await closed;
    const bad = new WebSocket(address.replace('http', 'ws') + '/ws', {
      headers: { cookie: f.headers.cookie, origin: 'http://evil.invalid' },
    });
    bad.on('error', () => {});
    const status = await new Promise<number>((resolve) =>
      bad.once('unexpected-response', (_req, response) => {
        resolve(response.statusCode!);
        response.destroy();
        bad.terminate();
      }),
    );
    assert.equal(status, 403);
  } finally {
    await f.close();
  }
});
test('real hook executable returns Claude documented permission output for its exact invocation', async () => {
  const f = await fixture({ harness: 'claude' });
  try {
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', 'scripts/claude-permission-hook.ts'],
      {
        cwd: process.cwd(),
        env: { ...process.env, RC_HOOK_SOCKET: path.join(f.dir, 'hooks.sock') },
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
    let stdout = '';
    child.stdout.on('data', (c) => (stdout += c));
    const exited = new Promise<number | null>((resolve) => child.on('exit', resolve));
    child.stdin.end(
      JSON.stringify({
        session_id: f.session.nativeSessionId,
        hook_event_name: 'PermissionRequest',
        tool_name: 'Bash',
        tool_input: { command: 'npm test', api_key: 'private' },
      }),
    );
    await eventually(() =>
      f.gateway.store.interactions(f.session.id).some((i) => i.status === 'pending'),
    );
    const i = f.gateway.store.interactions(f.session.id)[0];
    assert.equal((i.metadata.input as any).api_key, '[REDACTED]');
    const result = await f.gateway.app.inject({
      method: 'POST',
      url: `/api/interactions/${i.id}/respond`,
      headers: f.headers,
      payload: { response: 'allow' },
    });
    assert.equal(result.statusCode, 200);
    assert.equal(await exited, 0);
    assert.deepEqual(JSON.parse(stdout), {
      hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } },
    });
    assert.equal(f.gateway.store.interaction(i.id).status, 'resolved');
    assert.equal(f.mock.prompts.length, 0);
  } finally {
    await f.close();
  }
});
test('offline hook falls back to Claude original terminal permission flow', async () => {
  const child = spawn(process.execPath, ['--import', 'tsx', 'scripts/claude-permission-hook.ts'], {
    env: { ...process.env, RC_HOOK_SOCKET: '/tmp/relay-nonexistent-hook.sock' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (c) => (out += c));
  child.stdin.end('{}');
  await new Promise((resolve) => child.once('exit', resolve));
  assert.deepEqual(JSON.parse(out), {});
});

test('session creation and host folder browsing require an administrator', async () => {
  const f = await fixture({ startRuntime: false });
  try {
    const { app, auth } = f.gateway;
    const admin = auth.authenticate(f.headers.cookie.split('=')[1]);
    const tokens = auth.pair(auth.pairCode(admin), 'Read-only phone');
    const headers = { ...f.headers, cookie: `rc_access=${tokens.access}` };
    for (const url of [
      '/api/launch/profiles',
      '/api/launch/folders?profileId=fred',
      '/api/launch/' + randomUUID(),
    ]) {
      assert.equal((await app.inject({ url })).statusCode, 401);
      assert.equal((await app.inject({ url, headers })).statusCode, 403);
    }
    assert.equal(
      (await app.inject({ method: 'POST', url: '/api/launch', headers, payload: {} })).statusCode,
      403,
    );
    assert.equal(f.gateway.store.db.prepare('SELECT COUNT(*) AS n FROM launches').get()!.n, 0);
  } finally {
    await f.close();
  }
});
