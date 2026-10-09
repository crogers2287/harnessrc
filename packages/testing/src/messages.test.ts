import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fixture } from './helpers.ts';
import { DeliveryDeferred } from '@harnessrc/protocol';

async function post(f: Awaited<ReturnType<typeof fixture>>, body: unknown) {
  return f.gateway.app.inject({
    method: 'POST',
    url: `/api/sessions/${f.session.id}/messages`,
    headers: { ...f.headers, 'content-type': 'application/json' },
    payload: JSON.stringify(body),
  });
}

test('automatic message steers from native working state despite stale idle UI and older queued/running tasks', async () => {
  const f = await fixture({ startRuntime: false });
  try {
    const stale = f.gateway.runtime.queue.add(f.session.id, {
      prompt: 'old work',
      idempotencyKey: randomUUID(),
    });
    stale.status = 'running';
    f.gateway.store.saveTask(stale);
    const queued = f.gateway.runtime.queue.add(f.session.id, {
      prompt: 'explicit later',
      idempotencyKey: randomUUID(),
    });
    f.mock.status = 'working'; // Store/UI still says idle.
    const input = {
      prompt: 'change the active turn',
      idempotencyKey: randomUUID(),
      attachments: [],
    };
    const response = await post(f, input);
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().mode, 'steer');
    assert.equal(f.gateway.store.tasks(f.session.id).length, 2);
    assert.equal(f.gateway.store.task(queued.id).status, 'pending');
    assert.equal(
      f.mock.events.filter((e) => e.kind === 'progress' && e.data.text === input.prompt).length,
      1,
    );
    assert.equal((await post(f, input)).statusCode, 200);
    assert.equal(
      f.mock.events.filter((e) => e.kind === 'progress' && e.data.text === input.prompt).length,
      1,
    );
    assert.equal((await post(f, { ...input, prompt: 'changed content' })).statusCode, 409);
  } finally {
    await f.close();
  }
});

test('automatic idle send dispatches immediately, never emits task.queued, and replays without a new turn', async () => {
  const f = await fixture({ startRuntime: false });
  try {
    const s = f.session;
    s.status = 'working';
    f.gateway.store.saveSession(s); // Stale phone working state.
    const input = { prompt: 'Keep working for steering UI test', idempotencyKey: randomUUID() };
    const response = await post(f, input);
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().mode, 'send');
    assert.equal(response.json().task.status, 'running');
    assert.equal(response.json().task.delivery, 'immediate');
    assert.equal(f.gateway.store.events(s.id).filter((e) => e.kind === 'task.queued').length, 0);
    assert.equal((await post(f, input)).statusCode, 200);
    assert.equal(f.mock.prompts.length, 1);
  } finally {
    await f.close();
  }
});

test('unsupported steering, blocked interaction, and ended turns never fall back to a queue', async () => {
  const f = await fixture({ startRuntime: false });
  try {
    f.mock.status = 'working';
    const s = f.session;
    s.capabilities.steerActiveTurn = false;
    f.gateway.store.saveSession(s);
    const input = { prompt: 'not a queued task', idempotencyKey: randomUUID() };
    const response = await post(f, input);
    assert.equal(response.statusCode, 409);
    assert.match(response.body, /does not support native steering/);
    assert.equal(f.gateway.store.tasks(s.id).length, 0);
    f.mock.status = 'blocked';
    assert.equal((await post(f, { ...input, idempotencyKey: randomUUID() })).statusCode, 409);
    assert.equal(f.gateway.store.tasks(s.id).length, 0);
    s.capabilities.steerActiveTurn = true;
    f.gateway.store.saveSession(s);
    f.mock.status = 'working';
    f.gateway.runtime.adapters.get(s.id)!.steer = async () => {
      throw new Error('Turn ended during delivery');
    };
    assert.equal((await post(f, { ...input, idempotencyKey: randomUUID() })).statusCode, 409);
    assert.equal(f.gateway.store.tasks(s.id).length, 0);
  } finally {
    await f.close();
  }
});

test('an idle-to-busy race records a failed immediate send, not a future queued instruction', async () => {
  const f = await fixture({ startRuntime: false });
  try {
    f.gateway.runtime.adapters.get(f.session.id)!.send = async () => {
      throw new DeliveryDeferred('Native turn started concurrently');
    };
    const input = { prompt: 'send now only', idempotencyKey: randomUUID() };
    assert.equal((await post(f, input)).statusCode, 409);
    const tasks = f.gateway.store.tasks(f.session.id);
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].status, 'failed');
    assert.equal((await post(f, input)).statusCode, 409);
    assert.equal(f.gateway.store.tasks(f.session.id).length, 1);
  } finally {
    await f.close();
  }
});

test('lost message confirmation stays uncertain across gateway restart without replaying native steer', async () => {
  const f = await fixture({ startRuntime: false });
  try {
    f.mock.status = 'working';
    const adapter = f.gateway.runtime.adapters.get(f.session.id)!;
    const steer = adapter.steer!.bind(adapter);
    adapter.steer = async (session, prompt) => {
      await steer(session, prompt);
      throw new Error('Connection lost after delivery');
    };
    const input = { prompt: 'Exactly once native steering', idempotencyKey: randomUUID() };
    assert.equal((await post(f, input)).statusCode, 409);
    await f.restart();
    assert.equal((await post(f, input)).statusCode, 409);
    assert.equal(
      f.mock.events.filter((e) => e.kind === 'progress' && e.data.text === input.prompt).length,
      1,
    );
    assert.equal(f.gateway.store.tasks(f.session.id).length, 0);
  } finally {
    await f.close();
  }
});

test('steering with uploads delivers file references once, protects saved uploads, and never queues', async () => {
  const f = await fixture({ startRuntime: false });
  try {
    f.mock.status = 'working';
    const file = f.gateway.runtime.attachments.add(
      f.session,
      'review.txt',
      'text/plain',
      Buffer.from('STEER_FILE_OK'),
    );
    const input = {
      prompt: 'Use this file now',
      attachments: [file.id],
      idempotencyKey: randomUUID(),
    };
    const result = await post(f, input);
    assert.equal(result.statusCode, 200, result.body);
    assert.equal(result.json().mode, 'steer');
    const delivered = f.mock.events.filter(
      (e) => e.kind === 'progress' && String(e.data.text).includes('review.txt'),
    );
    assert.equal(delivered.length, 1);
    assert.match(String(delivered[0].data.text), /uploads\/.*\.txt/);
    assert.equal(f.gateway.store.tasks(f.session.id).length, 0);
    assert.throws(() => f.gateway.runtime.attachments.remove(f.session, file.id), /saved message/);
    await f.restart();
    assert.equal((await post(f, input)).statusCode, 200);
    assert.equal(
      f.mock.events.filter(
        (e) => e.kind === 'progress' && String(e.data.text).includes('review.txt'),
      ).length,
      1,
    );
    assert.equal(
      (await post(f, { ...input, idempotencyKey: randomUUID(), attachments: [randomUUID()] }))
        .statusCode,
      409,
    );
    assert.equal(
      (await post(f, { ...input, prompt: 'x'.repeat(32000), idempotencyKey: randomUUID() }))
        .statusCode,
      409,
    );
  } finally {
    await f.close();
  }
});

test('receipt lookup finds an attachment echo outside the current page and enforces session authorization', async () => {
  const f = await fixture({ startRuntime: false });
  try {
    const key = randomUUID(),
      nativeId = randomUUID();
    f.gateway.store.db
      .prepare('INSERT INTO message_receipts VALUES(?,?,?,?,?,?,?)')
      .run(
        key,
        'device',
        f.session.id,
        'hash',
        'confirmed',
        JSON.stringify({ mode: 'send', task: { id: nativeId } }),
        new Date().toISOString(),
      );
    const url = `/api/sessions/${f.session.id}/message-receipts/${key}`;
    assert.equal(
      (await f.gateway.app.inject({ url, headers: f.headers })).json().nativeSeen,
      false,
    );
    f.gateway.store.event(f.session, {
      sourceId: 'old-native-echo',
      kind: 'user.message',
      timestamp: new Date().toISOString(),
      data: { taskId: nativeId, text: 'Old message' },
    });
    assert.equal((await f.gateway.app.inject({ url, headers: f.headers })).json().nativeSeen, true);
    assert.equal((await f.gateway.app.inject({ url })).statusCode, 401);
    assert.equal(
      (
        await f.gateway.app.inject({
          url: `/api/sessions/other/message-receipts/${key}`,
          headers: f.headers,
        })
      ).statusCode >= 400,
      true,
    );
  } finally {
    await f.close();
  }
});
