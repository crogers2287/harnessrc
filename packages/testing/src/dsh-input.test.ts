import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { DshClient } from '../../adapters/src/dsh.ts';
import { DshAdapter } from '../../adapters/src/dsh-session.ts';
import { fixture } from './helpers.ts';

test('DSH file/image steering preserves bytes and receipt identity, never queues or resends', async () => {
  const f = await fixture({ startRuntime: false });
  const calls: any[] = [];
  const uploads: { session: string | null; name: string | null; bytes: Buffer }[] = [];
  let running = true;
  let rejectImage = false;
  let omitAcknowledgement = false;
  const server = createServer(async (req, res) => {
    assert.equal(req.headers.cookie, 'native=fixture');
    if (req.url === '/api/session/uploadFileBinary') {
      res.writeHead(400);
      res.end('sessionId is required');
      return;
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const bytes = Buffer.concat(chunks);
    const url = new URL(req.url!, 'http://localhost');
    res.setHeader('content-type', 'application/json');
    if (url.pathname === '/api/session/uploadFileBinary') {
      assert.equal(req.headers['content-type'], 'application/octet-stream');
      uploads.push({
        session: url.searchParams.get('sessionId'),
        name: url.searchParams.get('name'),
        bytes,
      });
      res.end(JSON.stringify({ ok: true, value: { receiptId: 'native-file-receipt' } }));
      return;
    }
    const body = JSON.parse(bytes.toString());
    calls.push(body);
    let value: unknown = { accepted: true };
    if (body.method === 'session/list')
      value = {
        items: [
          {
            sessionId: f.session.nativeSessionId,
            updatedAt: Date.now(),
            running,
            agentAvailable: true,
          },
        ],
      };
    const result =
      body.method === 'session/prompt' && rejectImage
        ? {
            ok: false,
            error: {
              code: 'session/attachment-invalid',
              message: 'Unsupported model image modality',
            },
          }
        : {
            ok: true,
            value: body.method === 'session/prompt' && omitAcknowledgement ? undefined : value,
          };
    res.end(JSON.stringify({ type: 'server-response', rpcId: body.rpcId, result }));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const endpoint = `http://127.0.0.1:${(server.address() as any).port}`;
  const client = new DshClient(endpoint, async () => 'native=fixture');
  const files = f.gateway.runtime.attachments;
  const adapter = new DshAdapter(
    client,
    endpoint,
    async () => 'native=fixture',
    () => {},
    undefined,
    (s, id) => {
      const { row, bytes } = files.read(s, id);
      return { name: String(row.name), mime: String(row.mime), bytes };
    },
  );
  f.gateway.runtime.adapters.set(f.session.id, adapter);
  const post = (input: unknown) =>
    f.gateway.app.inject({
      method: 'POST',
      url: `/api/sessions/${f.session.id}/messages`,
      headers: f.headers,
      payload: input as any,
    });
  const prompts = () => calls.filter((c) => c.method === 'session/prompt');
  try {
    assert.equal(await client.supportsAttachments(), true);
    assert.equal(adapter.capabilities.attachFiles, true);
    const png = Buffer.from('png-image-fixture');
    const image = files.add(f.session, 'screen.png', 'image/png', png);
    const file = files.add(f.session, 'notes.txt', 'text/plain', Buffer.from('exact file content'));
    const input = {
      prompt: 'Inspect these now',
      idempotencyKey: randomUUID(),
      attachments: [image.id, file.id],
    };
    const response = await post(input);
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().mode, 'steer');
    assert.equal(f.gateway.store.tasks(f.session.id).length, 0);
    assert.deepEqual(prompts()[0].payload.args.request, {
      sessionId: f.session.nativeSessionId,
      requestId: input.idempotencyKey,
      mode: 'steer',
      content: [
        { type: 'text', text: input.prompt },
        { type: 'image', mediaType: 'image/png', name: 'screen.png', data: png.toString('base64') },
        { type: 'file', receiptId: 'native-file-receipt' },
      ],
    });
    assert.deepEqual(uploads[0], {
      session: f.session.nativeSessionId,
      name: 'notes.txt',
      bytes: Buffer.from('exact file content'),
    });
    assert.equal((await post(input)).statusCode, 200);
    assert.equal(prompts().length, 1);
    assert.equal(uploads.length, 1);
    const echo = files.nativeEvent(f.session, {
      sourceId: 'dsh:7',
      timestamp: new Date().toISOString(),
      kind: 'user.message',
      data: { text: input.prompt, requestId: input.idempotencyKey },
    });
    assert.deepEqual(
      (echo.data.attachments as any[]).map((a) => a.id),
      input.attachments,
    );
    assert.throws(() => files.remove(f.session, file.id), /saved message/);
    f.gateway.store.saveSession({ ...f.session, id: 'other-owner' });
    const foreign = files.add(
      { ...f.session, id: 'other-owner' },
      'private.txt',
      'text/plain',
      Buffer.from('private'),
    );
    assert.equal(
      (await post({ ...input, idempotencyKey: randomUUID(), attachments: [file.id, foreign.id] }))
        .statusCode,
      409,
    );
    assert.equal(uploads.length, 1);
    assert.equal(prompts().length, 1);
    rejectImage = true;
    const rejected = await post({
      ...input,
      idempotencyKey: randomUUID(),
      attachments: [image.id],
    });
    assert.equal(rejected.statusCode, 409);
    assert.match(rejected.body, /image-capable model/);
    rejectImage = false;
    omitAcknowledgement = true;
    const unconfirmed = { prompt: 'Uncertain delivery', idempotencyKey: randomUUID() };
    assert.equal((await post(unconfirmed)).statusCode, 400);
    const before = prompts().length;
    assert.equal((await post(unconfirmed)).statusCode, 409);
    assert.equal(prompts().length, before);
    omitAcknowledgement = false;
    running = false;
    const idle = await post({ ...input, idempotencyKey: randomUUID(), prompt: 'Read the files' });
    assert.equal(idle.statusCode, 200, idle.body);
    assert.equal(idle.json().mode, 'send');
    assert.equal(prompts().at(-1).payload.args.request.mode, 'queue');
    assert.equal(prompts().at(-1).payload.args.request.content.length, 3);
    const task = idle.json().task;
    const idleEcho = files.nativeEvent(f.session, {
      ...echo,
      data: { text: '', requestId: task.id },
    });
    assert.equal((idleEcho.data.attachments as any[]).length, 2);
  } finally {
    adapter.close();
    await new Promise<void>((r) => server.close(() => r()));
    await f.close();
  }
});
