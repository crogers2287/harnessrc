import { test } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { fixture, eventually } from './helpers.ts';

test('incremental WebSocket conversation events enforce session grants and device revocation', async () => {
  const f = await fixture({ startRuntime: false });
  let socket: WebSocket | undefined;
  try {
    const { auth, store, app } = f.gateway;
    const admin = auth.authenticate(f.headers.cookie.split('=')[1]);
    const tokens = auth.pair(auth.pairCode(admin), 'Stream reader');
    const phone = auth.authenticate(tokens.access);
    auth.grant(admin, phone.id, f.session.id, false);
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    socket = new WebSocket(address.replace('http', 'ws') + '/ws', {
      headers: { cookie: `rc_access=${tokens.access}`, origin: f.config.origin },
    });
    const frames: any[] = [];
    socket.on('message', (value) => frames.push(JSON.parse(String(value))));
    await new Promise<void>((resolve, reject) => {
      socket!.once('open', resolve);
      socket!.once('error', reject);
    });
    const other = { ...f.session, id: 'ungranted-session' };
    store.saveSession(other);
    store.event(other, {
      sourceId: 'private-event',
      kind: 'assistant.message',
      timestamp: new Date().toISOString(),
      data: { text: 'PRIVATE' },
    });
    store.event(f.session, {
      sourceId: 'allowed-event',
      kind: 'assistant.delta',
      timestamp: new Date().toISOString(),
      data: { itemId: 'reply', text: 'Allowed stream' },
    });
    await eventually(() => frames.some((x) => x.type === 'event'));
    assert.deepEqual(
      frames.filter((x) => x.type === 'event').map((x) => x.event.sessionId),
      [f.session.id],
    );
    const closed = new Promise((resolve) => socket!.once('close', resolve));
    auth.revoke(admin, phone.id);
    store.event(f.session, {
      sourceId: 'revoked-event',
      kind: 'assistant.delta',
      timestamp: new Date().toISOString(),
      data: { itemId: 'reply', text: 'Not delivered' },
    });
    await closed;
    assert.equal(frames.filter((x) => x.type === 'event').length, 1);
  } finally {
    socket?.terminate();
    await f.close();
  }
});
