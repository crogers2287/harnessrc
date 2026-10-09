import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { fixture } from './helpers.ts';
import { VoiceService, voiceConfigSchema } from '../../../apps/gateway/src/voice.ts';
test('dictation requires session control, returns cleaned text without creating turns or storing audio', async () => {
  let cleanupFails = false,
    blank = false,
    requests = 0;
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    requests++;
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/asr') {
      assert.match(req.headers['content-type'] ?? '', /multipart\/form-data/);
      assert.match(body, /dictation.webm/);
      res.end(JSON.stringify({ text: blank ? '' : 'um keep port forty two and do not send' }));
    } else {
      const data = JSON.parse(body);
      assert.equal(data.messages[1].content, 'um keep port forty two and do not send');
      assert.match(data.messages[0].content, /never an answer/);
      if (cleanupFails) {
        res.writeHead(503);
        res.end('{}');
      } else
        res.end(
          JSON.stringify({
            choices: [
              {
                finish_reason: 'stop',
                message: { content: 'Keep port forty two and do not send.' },
              },
            ],
          }),
        );
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const f = await fixture({
    startRuntime: false,
    voice: {
      transcriptionUrl: base + '/asr',
      model: 'test',
      cleanup: { endpoint: base + '/clean', model: 'editor' },
    },
  });
  const route = `/api/sessions/${f.session.id}/dictation?mime=audio/webm`;
  const headers = { ...f.headers, 'content-type': 'application/octet-stream' };
  try {
    assert.equal(
      (
        await f.gateway.app.inject({
          method: 'POST',
          url: route,
          headers: { 'content-type': 'application/octet-stream' },
          payload: Buffer.from('test'),
        })
      ).statusCode,
      403,
    );
    const admin = f.gateway.auth.authenticate(f.headers.cookie.split('=')[1]);
    const device = f.gateway.auth.pair(f.gateway.auth.pairCode(admin), 'Read only');
    const reader = f.gateway.auth.authenticate(device.access);
    f.gateway.auth.grant(admin, reader.id, f.session.id, false);
    assert.equal(
      (
        await f.gateway.app.inject({
          method: 'POST',
          url: route,
          headers: { ...headers, cookie: `rc_access=${device.access}` },
          payload: Buffer.from('test'),
        })
      ).statusCode,
      403,
    );
    assert.equal(requests, 0);
    const response = await f.gateway.app.inject({
      method: 'POST',
      url: route,
      headers,
      payload: Buffer.from('audio fixture'),
    });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), {
      text: 'Keep port forty two and do not send.',
      original: 'um keep port forty two and do not send',
      cleaned: true,
    });
    assert.equal(f.mock.prompts.length, 0);
    assert.equal(f.gateway.store.tasks(f.session.id).length, 0);
    assert.equal(
      f.gateway.store.events(f.session.id).some((e) => e.kind === 'user.message'),
      false,
    );
    cleanupFails = true;
    const fallback = await f.gateway.app.inject({
      method: 'POST',
      url: route,
      headers,
      payload: Buffer.from('audio fixture'),
    });
    assert.equal(fallback.json().cleaned, false);
    assert.equal(fallback.json().text, 'um keep port forty two and do not send');
    assert.ok(fallback.json().warning);
    blank = true;
    const silent = await new VoiceService(f.config.voice).transcribe(
      Buffer.from('silence'),
      'audio/webm',
    );
    assert.equal(silent.text, '');
    await assert.rejects(
      new VoiceService(f.config.voice).transcribe(Buffer.alloc(0), 'audio/webm'),
      /Recording must/,
    );
    await assert.rejects(
      new VoiceService().transcribe(Buffer.from('x'), 'audio/webm'),
      /not configured/,
    );
    assert.throws(() => voiceConfigSchema.parse({ transcriptionUrl: 'file:///etc/passwd' }));
  } finally {
    await f.close();
    await new Promise<void>((r) => server.close(() => r()));
  }
});
