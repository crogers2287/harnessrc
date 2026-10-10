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
    let value: any = undefined;
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
        { id: 'layout', selected: [], custom: 'Use the installed skill' },
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

test('timed DSH questions hold beyond their deadline and release only after native acceptance', async () => {
  let accepted = false,
    released = false,
    claims = 0;
  let finish!: () => void;
  const reply = new Promise<void>((r) => {
    finish = r;
  });
  const server = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    await reply;
    accepted = true;
    res.end(
      JSON.stringify({
        type: 'server-response',
        rpcId: body.rpcId,
        result: { ok: true },
      }),
    );
  });
  const wss = new WebSocketServer({ server });
  const timers: NodeJS.Timeout[] = [];
  let generations = 0;
  wss.on('connection', (ws) => {
    let held = false;
    ws.on('message', (bytes) => {
      const msg = JSON.parse(bytes.toString());
      if (msg.endpoint === '$events') {
        generations++;
        ws.send(
          JSON.stringify({
            type: 'item',
            streamId: 'questions',
            value: { type: 'ready', clientId: `client-${generations}` },
          }),
        );
        const frame = {
          type: 'waterfall',
          event: 'user-questions/request',
          eventId: 'timed',
          agentId: 'native-session',
          request: {
            questions: [{ id: 'choice', question: 'Choose', options: [{ label: 'Yes' }] }],
            wait: { callId: 'tool-call', timed: true },
          },
        };
        // Duplicate replay must not open multiple claims.
        for (let i = 0; i < 2; i++)
          ws.send(JSON.stringify({ type: 'item', streamId: 'questions', value: frame }));
        timers.push(
          setTimeout(() => {
            if (!held && ws.readyState === 1)
              ws.send(
                JSON.stringify({
                  type: 'item',
                  streamId: 'questions',
                  value: { type: 'cancel', eventId: 'timed' },
                }),
              );
          }, 100),
        );
      } else if (msg.type === 'open') {
        assert.equal(msg.endpoint, 'userQuestions/attachWait');
        assert.deepEqual(msg.payload.args, { agentId: 'native-session', callId: 'tool-call' });
        held = true;
        claims++;
        ws.send(
          JSON.stringify({ type: 'item', streamId: msg.streamId, value: { remainingMs: 100 } }),
        );
      } else if (msg.type === 'cancel') {
        assert.equal(accepted, true, 'claim must survive pending HTTP acknowledgement');
        held = false;
        released = true;
        ws.send(JSON.stringify({ type: 'end', streamId: msg.streamId }));
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const endpoint = `http://127.0.0.1:${(server.address() as any).port}`;
  const questions = new DshQuestions(
    endpoint,
    async () => 'fixture',
    new DshClient(endpoint, async () => 'fixture'),
  );
  try {
    await questions.start();
    await eventually(() => claims === 1);
    await new Promise((r) => setTimeout(r, 180));
    assert.equal(questions.hasPending('native-session'), true);
    assert.equal(questions.interactions('native-session')[0].expiresAt, '9999-12-31T23:59:59.999Z');
    // Native replay after gateway transport loss reacquires exactly one hold.
    for (const ws of wss.clients) ws.close();
    await eventually(() => claims === 2);
    const answer = questions.respond('native-session', 'timed', {
      answers: [{ id: 'choice', selected: ['Yes'] }],
    });
    await new Promise((r) => setTimeout(r, 180));
    assert.equal(released, false);
    finish();
    await answer;
    await eventually(() => released);
    assert.equal(questions.hasPending('native-session'), false);
    // Ending the hold stream must not reset the host-wide event channel.
    assert.deepEqual(questions.interactions('native-session'), []);
    assert.equal(generations, 2);
  } finally {
    finish();
    questions.close();
    timers.forEach(clearTimeout);
    for (const ws of wss.clients) ws.terminate();
    await new Promise<void>((r) => wss.close(() => r()));
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test('native absence retires an uncertain DSH card without retrying its answer', async () => {
  const f = await fixture({ startRuntime: false });
  try {
    const i = f.gateway.runtime.broker.open(f.session.id, {
      nativeRequestId: 'ended-question',
      type: 'free-text',
      prompt: 'Ended',
      choices: [],
      responseSchema: { type: 'object' },
      expiresAt: '9999-12-31T23:59:59.999Z',
      route: 'dsh-native',
      metadata: {},
    });
    i.status = 'uncertain';
    f.gateway.store.saveInteraction(i);
    const adapter = f.gateway.runtime.adapters.get(f.session.id)!;
    adapter.interactions = async () => [];
    await f.gateway.runtime.tick();
    assert.equal(f.gateway.store.interaction(i.id).status, 'stale');
    assert.equal(f.mock.prompts.length, 0);
  } finally {
    await f.close();
  }
});
