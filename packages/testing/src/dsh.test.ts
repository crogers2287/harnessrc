import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { DshClient } from '../../adapters/src/dsh.ts';

test('DSH native transport preserves steering, request identity, exact model and auth', async () => {
  const requests: any[] = [];
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const part of req) body += part;
    const value = JSON.parse(body);
    requests.push(value);
    assert.equal(req.headers.cookie, 'test_session=fixture');
    assert.equal(req.url, `/api/${value.method}`);
    res.setHeader('content-type', 'application/json');
    res.end(
      JSON.stringify({
        type: 'server-response',
        rpcId: value.rpcId,
        result: { ok: true, value: { accepted: true } },
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = (server.address() as { port: number }).port;
    const client = new DshClient(`http://127.0.0.1:${port}`, async () => 'test_session=fixture');
    await client.prompt('native-session', 'durable-id', 'Update this turn', 'steer');
    await client.selectModel('native-session', 'cfrproxy', 'gpt-6-astra');
    assert.equal(requests[0].payload.args.request.mode, 'steer');
    assert.equal(requests[0].payload.args.request.requestId, 'durable-id');
    assert.equal(requests[1].payload.args.request.model, 'gpt-6-astra');
    assert.throws(() => client.prompt('native-session', '', 'hello', 'steer'), /incomplete/);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('DSH transport rejects unsafe endpoint and missing credentials before dispatch', async () => {
  assert.throws(() => new DshClient('http://remote.invalid', async () => 'cookie'), /HTTPS/);
  const client = new DshClient('http://127.0.0.1:1', async () => '');
  await assert.rejects(client.list(), /authentication/);
});
