import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.ts';
import { listenTailnet } from '../../../apps/gateway/src/tailnet.ts';
import WebSocket from 'ws';

test('tailnet devices need no pairing on the private listener; public forwarded headers cannot bypass auth', async () => {
  const f = await fixture({
    startRuntime: false,
    tailnetLookup: async (ip) => {
      if (ip !== '100.64.0.10') throw new Error('Unknown peer');
      return { id: 'verified-node', name: 'Test phone' };
    },
  });
  const server = await listenTailnet(f.gateway.app, 0);
  const origin = `http://127.0.0.1:${(server.address() as any).port}`;
  const headers = { 'X-Forwarded-For': '100.64.0.10', Origin: f.config.origin };
  try {
    const publicSpoof = await f.gateway.app.inject({
      url: '/api/sessions',
      headers: { ...headers, 'Tailscale-User-Login': 'spoofed@example.com' },
    });
    assert.equal(publicSpoof.statusCode, 401);
    const me = await fetch(origin + '/api/auth/me', { headers });
    assert.equal(me.status, 200);
    const device = ((await me.json()) as any).device;
    assert.equal(device.id, 'tailscale:verified-node');
    const sessions = (await fetch(origin + '/api/sessions', { headers }).then((r) =>
      r.json(),
    )) as any;
    assert.equal(sessions.sessions[0].capabilities.sendMessage, true);
    assert.equal(
      (
        await fetch(origin + '/api/sessions', {
          headers: { ...headers, 'X-Forwarded-For': '100.64.0.11' },
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await fetch(origin + '/api/sessions', {
          headers: { ...headers, Origin: 'https://attacker.test' },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(origin + `/api/sessions/${f.session.id}/tasks`, {
          method: 'POST',
          headers,
          body: '{}',
        })
      ).status,
      403,
    );
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(origin.replace('http:', 'ws:') + '/ws', { headers });
      ws.once('message', (data) => {
        assert.equal(JSON.parse(data.toString()).type, 'invalidate');
        ws.close();
        resolve();
      });
      ws.once('error', reject);
    });
    f.gateway.store.db.prepare('UPDATE devices SET revoked=1 WHERE id=?').run(device.id);
    assert.equal((await fetch(origin + '/api/auth/me', { headers })).status, 401);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    await f.close();
  }
});
