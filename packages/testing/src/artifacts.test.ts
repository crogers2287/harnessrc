import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fixture } from './helpers.ts';
test('artifacts publish once, survive restart, enforce owner and permission, and never prompt agents', async () => {
  const f = await fixture({ startRuntime: false });
  try {
    const id = f.session.id,
      generation = f.session.generation;
    const params = new URLSearchParams({
      requestId: randomUUID(),
      generation,
      name: 'result.png',
      mime: 'image/png',
      title: 'Pipeline output',
      caption: 'Generated test image',
    });
    const url = `/api/sessions/${id}/artifacts?${params}`;
    const payload = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP1sAAAAASUVORK5CYII=',
      'base64',
    );
    const headers = { ...f.headers, 'content-type': 'application/octet-stream' };
    const post = (h = headers, p = payload) =>
      f.gateway.app.inject({ method: 'POST', url, headers: h, payload: p });
    assert.equal(
      (await post({ 'content-type': 'application/octet-stream', 'x-rc-request': '1' } as any))
        .statusCode,
      401,
    );
    const session = f.session;
    session.capabilities.attachFiles = false;
    f.gateway.store.saveSession(session);
    const response = await post();
    assert.equal(response.statusCode, 200, response.body);
    const event = response.json().event;
    assert.equal(event.kind, 'artifact.created');
    const file = event.data.attachments[0];
    assert.equal((await post()).json().event.id, event.id);
    assert.equal((await post(headers, Buffer.from('changed'))).statusCode, 409);
    assert.throws(() => f.gateway.runtime.attachments.remove(f.session, file.id), /saved message/);
    const download = await f.gateway.app.inject({
      url: `/api/sessions/${id}/attachments/${file.id}`,
      headers: f.headers,
    });
    assert.deepEqual(download.rawPayload, payload);
    assert.equal(download.headers['content-type'], 'application/octet-stream');
    const row = f.gateway.store.db
      .prepare('SELECT id FROM devices WHERE name=?')
      .get('Test browser')!;
    f.gateway.store.db.prepare('UPDATE devices SET admin=0 WHERE id=?').run(row.id);
    assert.equal((await post()).statusCode, 403);
    f.gateway.store.db.prepare('UPDATE devices SET admin=1 WHERE id=?').run(row.id);
    await f.restart();
    assert.equal((await post()).json().event.id, event.id);
    assert.equal(
      f.gateway.store.events(id, 0, 200).filter((e) => e.kind === 'artifact.created').length,
      1,
    );
    const changed = f.session;
    changed.generation = 'replacement';
    f.gateway.store.saveSession(changed);
    assert.equal((await post()).statusCode, 409);
    assert.equal(f.mock.prompts.length, 0);
  } finally {
    await f.close();
  }
});

test('native Codex image results become authenticated previews without base64 transcript leaks or replay duplicates', async () => {
  const { normalizeCodex } = await import('../../adapters/src/transcripts.ts');
  const { importNativeImage } = await import('../../../apps/gateway/src/artifacts.ts');
  const f = await fixture({ startRuntime: false });
  try {
    const image =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP1sAAAAASUVORK5CYII=';
    const record = {
      timestamp: '2026-10-09T12:00:00Z',
      type: 'response_item',
      payload: {
        type: 'custom_tool_call_output',
        call_id: 'image-call',
        output: [
          { type: 'input_text', text: 'Rendered preview' },
          { type: 'input_image', image_url: `data:image/png;base64,${image}` },
        ],
      },
    };
    const events = normalizeCodex(record, 12);
    assert.equal(events.length, 2);
    assert.equal(events[0].data.text, 'Rendered preview');
    assert.ok(!JSON.stringify(events[0]).includes(image));
    const imported = importNativeImage(
      f.gateway.store,
      f.gateway.runtime.attachments,
      f.session,
      events[1],
    );
    assert.equal(imported.timestamp, record.timestamp);
    assert.equal(
      importNativeImage(f.gateway.store, f.gateway.runtime.attachments, f.session, events[1]).id,
      imported.id,
    );
    assert.ok(!JSON.stringify(imported).includes(image));
    const file = (imported.data.attachments as any[])[0];
    const url = `/api/sessions/${f.session.id}/attachments/${file.id}`;
    const response = await f.gateway.app.inject({ url, headers: f.headers });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(file.mime, 'image/png');
    assert.equal(response.headers['content-type'], 'application/octet-stream');
    assert.deepEqual(response.rawPayload, Buffer.from(image, 'base64'));
    assert.equal((await f.gateway.app.inject({ url })).statusCode, 401);
    assert.equal(f.gateway.runtime.attachments.list(f.session).length, 1);
    assert.throws(
      () =>
        importNativeImage(f.gateway.store, f.gateway.runtime.attachments, f.session, {
          ...events[1],
          data: { nativeImageDataUrl: 'https://private/image.png' },
        }),
      /encoding/,
    );
  } finally {
    await f.close();
  }
});
