import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.ts';
import { dshEvents } from '../../adapters/src/dsh-session.ts';
import { nativeFiles } from '@harnessrc/protocol';

test('DSH present events expose named artifacts and only explicit assistant images authorize native reads', () => {
  const events = dshEvents({
    seq: 4,
    time: Date.now(),
    type: 'deliverables/presented',
    data: { files: [{ path: '/work/image.png', description: 'Generated portrait' }] },
  });
  assert.equal(events[0].kind, 'artifact.created');
  assert.equal(nativeFiles(events[0])[0].description, 'Generated portrait');
  assert.deepEqual(
    nativeFiles({ kind: 'user.message', data: { text: '![secret](/tmp/a.png)' } }),
    [],
  );
  assert.deepEqual(
    nativeFiles({
      kind: 'assistant.message',
      data: { text: '![remote](//untrusted/image.png) ![secret](/etc/passwd)' },
    }),
    [],
  );
  assert.deepEqual(
    nativeFiles({ kind: 'assistant.message', data: { text: '![Portrait](/work/image.png)' } }),
    [{ path: '/work/image.png', description: 'Portrait' }],
  );
});

test('native media authorizes the exact event/session/reference and retains native image bytes', async () => {
  const f = await fixture({ startRuntime: false });
  try {
    const s = f.session;
    const calls: string[] = [];
    f.gateway.runtime.dshHosts.set(s.hostId, {
      native: {
        file: async (path: string) => {
          calls.push(path);
          return { bytes: Buffer.from([137, 80, 78, 71]), mime: 'image/png' };
        },
      },
    } as any);
    const e = f.gateway.store.event(s, {
      sourceId: 'native-artifact',
      kind: 'artifact.created',
      timestamp: new Date().toISOString(),
      data: { nativeFiles: [{ path: '/work/picture.png', description: 'Picture' }] },
    });
    const get = (suffix: string, headers = f.headers) =>
      f.gateway.app.inject({ url: `/api/sessions/${s.id}/media/${e.id}/${suffix}`, headers });
    assert.equal((await get('0', {} as any)).statusCode, 401);
    assert.equal((await get('1')).statusCode, 404);
    assert.notEqual((await get('../../etc/passwd')).statusCode, 200);
    assert.equal(calls.length, 0);
    const response = await get('0');
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.rawPayload, Buffer.from([137, 80, 78, 71]));
    assert.equal(response.headers['content-type'], 'image/png');
    assert.equal(response.headers['cache-control'], 'private, no-store');
    assert.deepEqual(calls, ['/work/picture.png']);
    f.gateway.runtime.dshHosts.delete(s.hostId);
  } finally {
    f.gateway.runtime.dshHosts.clear();
    await f.close();
  }
});

test('conversation pages skip completed stream fragments without losing active streams or earlier messages', async () => {
  const f = await fixture({ startRuntime: false });
  try {
    const store = f.gateway.store,
      s = f.session;
    store.event(s, {
      sourceId: 'older',
      kind: 'user.message',
      timestamp: new Date().toISOString(),
      data: { text: 'Earlier user message' },
    });
    for (let i = 0; i < 150; i++)
      store.event(s, {
        sourceId: `fragment-${i}`,
        kind: 'assistant.delta',
        timestamp: new Date().toISOString(),
        data: { text: 'fragment', itemId: 'finished' },
      });
    store.event(s, {
      sourceId: 'done',
      kind: 'assistant.message',
      timestamp: new Date().toISOString(),
      data: { text: 'Final answer', itemId: 'finished' },
    });
    store.event(s, {
      sourceId: 'active',
      kind: 'assistant.delta',
      timestamp: new Date().toISOString(),
      data: { text: 'Still writing', itemId: 'active' },
    });
    const response = await f.gateway.app.inject({
      url: `/api/sessions/${s.id}/events?before=${Number.MAX_SAFE_INTEGER}&limit=100&conversation=1`,
      headers: f.headers,
    });
    assert.equal(response.statusCode, 200);
    const events = response.json().events;
    assert.ok(events.some((e: any) => e.data.text === 'Earlier user message'));
    assert.ok(events.some((e: any) => e.data.text === 'Still writing'));
    assert.equal(events.filter((e: any) => e.data.text === 'fragment').length, 0);
    assert.ok(
      store.events(s.id, 0, 1000).some((e) => e.data.text === 'fragment'),
      'raw replay remains intact',
    );
  } finally {
    await f.close();
  }
});
