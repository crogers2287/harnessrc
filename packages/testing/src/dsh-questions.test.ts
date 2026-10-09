import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { DshQuestions } from '../../adapters/src/dsh-questions.ts';
import { DshClient } from '../../adapters/src/dsh.ts';
import { DshAdapter } from '../../adapters/src/dsh-session.ts';
import { fixture, eventually } from './helpers.ts';
test('DSH pending waterfall replays, validates exact answers, claims once, and never posts a prompt', async () => {
  const f = await fixture({ startRuntime: false });
  const sid = f.session.nativeSessionId;
  const frames = [
    {
      type: 'waterfall',
      event: 'user-questions/request',
      eventId: 'question-one',
      agentId: sid,
      request: {
        questions: [
          {
            id: 'layout',
            question: 'Which layout?',
            options: [{ label: 'Compact' }, { label: 'Wide' }],
          },
          {
            id: 'features',
            question: 'Which features?',
            multiSelect: true,
            options: [{ label: 'Files' }, { label: 'Voice' }],
          },
        ],
      },
    },
  ];
  const calls: any[] = [];
  const server = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    calls.push(body);
    let value: any = {};
    if (body.method === 'session/list')
      value = {
        items: [{ sessionId: sid, updatedAt: Date.now(), agentAvailable: true, running: true }],
      };
    res.setHeader('content-type', 'application/json');
    res.end(
      JSON.stringify({ type: 'server-response', rpcId: body.rpcId, result: { ok: true, value } }),
    );
  });
  const ws = new WebSocketServer({ server });
  let generation = 0;
  ws.on('connection', (socket) =>
    socket.on('message', () => {
      socket.send(
        JSON.stringify({
          type: 'item',
          value: { type: 'ready', clientId: `client-${++generation}` },
        }),
      );
      for (const frame of frames) socket.send(JSON.stringify({ type: 'item', value: frame }));
    }),
  );
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const endpoint = `http://127.0.0.1:${(server.address() as any).port}`;
  const native = new DshClient(endpoint, async () => 'auth=fixture');
  const questions = new DshQuestions(endpoint, async () => 'auth=fixture', native);
  const adapter = new DshAdapter(
    native,
    endpoint,
    async () => 'auth=fixture',
    () => {},
    questions,
  );
  f.gateway.runtime.adapters.set(f.session.id, adapter);
  try {
    await questions.start();
    await eventually(() => questions.hasPending(sid));
    const input = questions.interactions(sid)[0];
    assert.equal(questions.interactions('another-session').length, 0);
    const i = f.gateway.runtime.broker.open(f.session.id, input);
    i.leaseUntil = 0;
    f.gateway.store.saveInteraction(i);
    f.gateway.runtime.broker.expire();
    assert.equal(f.gateway.store.interaction(i.id).status, 'expired');
    assert.equal(f.gateway.runtime.broker.open(f.session.id, input).status, 'pending');
    for (const socket of ws.clients) socket.close();
    await eventually(() => generation === 2);
    assert.equal(questions.interactions(sid)[0].nativeRequestId, i.nativeRequestId);
    const url = `/api/interactions/${i.id}/respond`;
    const bad = await f.gateway.app.inject({
      method: 'POST',
      url,
      headers: f.headers,
      payload: { response: { answers: [{ id: 'wrong', selected: ['Compact'] }] } },
    });
    assert.equal(bad.statusCode, 409);
    assert.equal(f.gateway.store.interaction(i.id).status, 'pending');
    const response = {
      answers: [
        { id: 'layout', selected: ['Compact'] },
        { id: 'features', selected: ['Voice', 'Files'], custom: 'Keep shortcuts' },
      ],
    };
    const results = await Promise.all(
      [1, 2].map(() =>
        f.gateway.app.inject({ method: 'POST', url, headers: f.headers, payload: { response } }),
      ),
    );
    assert.deepEqual(results.map((r) => r.statusCode).sort(), [200, 409]);
    const result = calls.filter((c) => c.method === '$events/result');
    assert.equal(result.length, 1);
    assert.equal(result[0].payload.args.clientId, 'client-2');
    assert.equal(result[0].payload.args.eventId, 'question-one');
    assert.deepEqual(result[0].payload.args.outcome, { kind: 'result', value: response });
    assert.equal(
      calls.some((c) => c.method === 'session/prompt'),
      false,
    );
    assert.equal(f.mock.prompts.length, 0);
    await assert.rejects(questions.respond(sid, 'question-one', response), /no longer pending/);
  } finally {
    questions.close();
    for (const socket of ws.clients) socket.terminate();
    await new Promise<void>((r) => ws.close(() => r()));
    await new Promise<void>((r) => server.close(() => r()));
    await f.close();
  }
});
