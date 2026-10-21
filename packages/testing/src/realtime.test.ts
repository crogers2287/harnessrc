import { test } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { fixture, eventually } from './helpers.ts';

test('unavailable native controls do not prevent transcript ingestion', async () => {
  const f = await fixture({ startRuntime: false });
  try {
    const { runtime, store } = f.gateway;
    runtime.refresh = async () => {};
    const adapter = runtime.adapters.get(f.session.id)!;
    adapter.interactions = async () => {
      throw new Error('Codex thread is not loaded');
    };
    adapter.read = async () => [
      {
        sourceId: 'read-despite-controls',
        kind: 'assistant.message',
        timestamp: new Date().toISOString(),
        data: { text: 'Transcript remains live' },
      },
    ];
    await runtime.tick();
    assert.equal(store.events(f.session.id).at(-1)?.data.text, 'Transcript remains live');
    assert.equal(store.session(f.session.id).diagnostic, 'Codex thread is not loaded');
  } finally {
    await f.close();
  }
});

test('conversation ingestion continues during slow discovery and coalesces overlapping reads', async () => {
  const f = await fixture({ startRuntime: false });
  let releaseDiscovery!: () => void;
  let releaseRead!: () => void;
  const blockedDiscovery = new Promise<void>((resolve) => {
    releaseDiscovery = resolve;
  });
  const blockedRead = new Promise<void>((resolve) => {
    releaseRead = resolve;
  });
  let discoveryStarted = false;
  let reads = 0;
  const { runtime, store } = f.gateway;
  const refresh = runtime.refresh.bind(runtime);
  let tick: Promise<void> | undefined;
  try {
    runtime.refresh = async () => {
      discoveryStarted = true;
      await blockedDiscovery;
    };
    const adapter = runtime.adapters.get(f.session.id)!;
    adapter.read = async () => {
      reads++;
      await blockedRead;
      return [
        {
          sourceId: 'independent-read',
          kind: 'assistant.message',
          timestamp: new Date().toISOString(),
          data: { text: 'Live while discovery waits' },
        },
      ];
    };
    tick = runtime.tick();
    await eventually(() => discoveryStarted);
    const first = runtime.readConversations();
    await eventually(() => reads === 1);
    const second = runtime.readConversations();
    releaseRead();
    await Promise.all([first, second]);
    assert.equal(reads, 1);
    assert.equal(store.events(f.session.id).at(-1)?.data.text, 'Live while discovery waits');
  } finally {
    releaseRead();
    releaseDiscovery();
    await tick;
    runtime.refresh = refresh;
    await f.close();
  }
});

test('a stalled transcript reader does not block another live conversation', async () => {
  const f = await fixture({ startRuntime: false });
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  let polling: Promise<void> | undefined;
  try {
    const { runtime, store } = f.gateway;
    const first = f.session;
    const adapter = runtime.adapters.get(first.id)!;
    adapter.read = async () => {
      await blocked;
      return [];
    };
    const other = { ...first, id: 'second-live-session' };
    store.saveSession(other);
    runtime.adapters.set(other.id, {
      capabilities: adapter.capabilities,
      read: async () => [
        {
          sourceId: 'fast-session-read',
          kind: 'assistant.message',
          timestamp: new Date().toISOString(),
          data: { text: 'Another conversation keeps moving' },
        },
      ],
    });
    polling = runtime.readConversations();
    await eventually(() => store.events(other.id).length === 1);
  } finally {
    release();
    await polling;
    await f.close();
  }
});

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

test('notification-only sockets send wakeups without conversation payloads and stop on revocation', async () => {
  const f = await fixture({ startRuntime: false });
  let socket: WebSocket | undefined;
  try {
    const { auth, app, store } = f.gateway;
    const admin = auth.authenticate(f.headers.cookie.split('=')[1]);
    const tokens = auth.pair(auth.pairCode(admin), 'Notification reader');
    const reader = auth.authenticate(tokens.access);
    auth.grant(admin, reader.id, f.session.id, false);
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    socket = new WebSocket(address.replace('http', 'ws') + '/ws?notifications=1', {
      headers: { cookie: `rc_access=${tokens.access}`, origin: f.config.origin },
    });
    const frames: any[] = [];
    socket.on('message', (value) => frames.push(JSON.parse(String(value))));
    await eventually(() => frames.length > 0);
    store.event(f.session, {
      sourceId: 'push-private-body',
      kind: 'turn.completed',
      timestamp: new Date().toISOString(),
      data: { text: 'Private conversation' },
    });
    await eventually(() => frames.length > 1);
    assert.ok(frames.every((frame) => JSON.stringify(frame) === '{"type":"notifications"}'));
    const closed = new Promise((resolve) => socket!.once('close', resolve));
    auth.revoke(admin, reader.id);
    store.emit('change');
    await closed;
  } finally {
    socket?.terminate();
    await f.close();
  }
});
