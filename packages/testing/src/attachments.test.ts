import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fixture } from './helpers.ts';
import { Attachments } from '../../storage/src/attachments.ts';

test('binary uploads are authorized, scoped, immutable and survive restart with queued references', async () => {
  const f = await fixture({ startRuntime: false });
  try {
    const url = `/api/sessions/${f.session.id}/attachments?name=example.txt&mime=text/plain`;
    const payload = Buffer.from('The upload proof is RELAY_FILE_OK');
    const headers = { ...f.headers, 'content-type': 'application/octet-stream' };
    assert.equal(
      (
        await f.gateway.app.inject({
          method: 'POST',
          url,
          payload,
          headers: { 'content-type': 'application/octet-stream', 'x-rc-request': '1' },
        })
      ).statusCode,
      401,
    );
    const response = await f.gateway.app.inject({ method: 'POST', url, payload, headers });
    assert.equal(response.statusCode, 200, response.body);
    const file = response.json().attachment;
    const id = f.session.id;
    assert.equal(
      f.gateway.runtime.attachments.read(f.session, file.id).bytes.toString(),
      payload.toString(),
    );
    assert.throws(
      () => f.gateway.runtime.attachments.get({ ...f.session, generation: 'replaced' }, file.id),
      /owner/,
    );
    assert.throws(
      () => f.gateway.runtime.attachments.get({ ...f.session, id: 'other' }, file.id),
      /owner/,
    );
    const key = randomUUID();
    const task = f.gateway.runtime.queue.add(id, {
      prompt: 'Read the upload',
      attachments: [file.id],
      idempotencyKey: key,
    });
    assert.throws(
      () =>
        f.gateway.runtime.queue.add(id, {
          prompt: 'Read the upload',
          attachments: [],
          idempotencyKey: key,
        }),
      /different content/,
    );
    assert.throws(() => f.gateway.runtime.attachments.remove(f.session, file.id), /saved message/);
    await f.gateway.runtime.queue.tick(id);
    assert.match(f.mock.prompts[0], /example\.txt/);
    assert.match(f.mock.prompts[0], /uploads\//);
    const recovered = new Attachments(f.gateway.store, f.dir);
    assert.equal(recovered.read(f.session, file.id).bytes.toString(), payload.toString());
    assert.equal(f.gateway.store.task(task.id).attachments[0], file.id);
    const download = await f.gateway.app.inject({
      url: `/api/sessions/${id}/attachments/${file.id}`,
      headers: f.headers,
    });
    assert.equal(download.headers['content-type'], 'application/octet-stream');
    assert.match(String(download.headers['content-disposition']), /^attachment;/);
    await f.restart();
    assert.equal(
      f.gateway.runtime.attachments.read(f.session, file.id).bytes.toString(),
      payload.toString(),
    );
    for (const name of ['../escape', 'a\\b', '\u001bescape'])
      assert.throws(() => recovered.add(f.session, name, 'text/plain', payload), /filename/);
    assert.throws(
      () => recovered.add(f.session, 'empty.txt', 'text/plain', Buffer.alloc(0)),
      /20 MB/,
    );
    assert.throws(
      () => recovered.add(f.session, 'big.txt', 'text/plain', Buffer.alloc(20 * 1024 * 1024 + 1)),
      /20 MB/,
    );
  } finally {
    await f.close();
  }
});
