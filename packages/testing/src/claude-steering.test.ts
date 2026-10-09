import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fixture } from './helpers.ts';

test('Claude hook steering registers exact owner, delivers once with files and survives restart', async () => {
  const f = await fixture({ harness: 'claude', startRuntime: false });
  try {
    let bridge = f.gateway.runtime.claudeSteering;
    const s = f.session;
    const payload = {
      session_id: s.nativeSessionId,
      hook_event_name: 'PreToolUse',
      sender_pids: [Number(s.processIdentity!.split(':')[1])],
    };
    assert.equal(bridge.available(s), false);
    await assert.rejects(() => bridge.submit(s, 'no hook'), /not connected/);
    await assert.rejects(
      () => bridge.handle('steer-poll', randomUUID(), { ...payload, sender_pids: [987654] }),
      /descend/,
    );
    assert.equal(bridge.available(s), false);
    await bridge.handle('steer-poll', randomUUID(), { ...payload, agent_id: 'subagent' });
    assert.equal(bridge.available(s), false);
    await bridge.handle('steer-poll', randomUUID(), payload);
    assert.equal(bridge.available(s), true);
    f.mock.status = 'working';
    const key = randomUUID();
    const file = f.gateway.runtime.attachments.add(
      s,
      'proof.txt',
      'text/plain',
      Buffer.from('FILE_PROOF'),
    );
    const body = { idempotencyKey: key, prompt: 'Change direction', attachments: [file.id] };
    const post = () =>
      f.gateway.app.inject({
        method: 'POST',
        url: `/api/sessions/${s.id}/messages`,
        headers: f.headers,
        payload: body,
      });
    assert.equal((await post()).statusCode, 200);
    assert.equal((await post()).statusCode, 200);
    assert.equal(f.mock.prompts.length, 0);
    assert.equal(f.gateway.store.tasks(s.id).length, 0);
    await f.restart();
    bridge = f.gateway.runtime.claudeSteering;
    assert.equal(bridge.available(f.session), true);
    const inv = randomUUID();
    const claim = await bridge.handle('steer-poll', inv, payload);
    assert.match(JSON.stringify(claim.output), /Change direction/);
    assert.match(JSON.stringify(claim.output), /proof.txt/);
    assert.equal(claim.acknowledge, true);
    // Neither another hook nor retry of this hook gets the same input twice.
    assert.deepEqual((await bridge.handle('steer-poll', randomUUID(), payload)).output, {});
    assert.deepEqual((await bridge.handle('steer-poll', inv, payload)).output, {});
    await bridge.handle('steer-ack', inv, payload);
    await bridge.handle('steer-ack', inv, payload);
    const echoes = f.gateway.store.events(s.id, 0, 10000).filter((e) => e.data.requestId === key);
    assert.equal(echoes.length, 1);
    assert.deepEqual(echoes[0].data.attachments, [
      { id: file.id, name: 'proof.txt', mime: 'text/plain' },
    ]);
    assert.equal(echoes[0].data.delivery, 'hook-context');
  } finally {
    await f.close();
  }
});

test('Claude hook stop consumes new steering only; replacements cannot inherit pending messages', async () => {
  const f = await fixture({ harness: 'claude', startRuntime: false });
  try {
    const bridge = f.gateway.runtime.claudeSteering;
    const s = f.session;
    const p = {
      session_id: s.nativeSessionId,
      hook_event_name: 'Stop',
      sender_pids: [Number(s.processIdentity!.split(':')[1])],
    };
    await bridge.handle('steer-poll', randomUUID(), p);
    await bridge.submit(s, 'Finish differently');
    const stop = await bridge.handle('steer-poll', randomUUID(), p);
    assert.equal((stop.output as any).decision, 'block');
    assert.match((stop.output as any).reason, /Finish differently/);
    assert.deepEqual((await bridge.handle('steer-poll', randomUUID(), p)).output, {});
    await bridge.submit(s, 'Do not give this to a replacement');
    f.gateway.store.db
      .prepare("UPDATE claude_hook_messages SET generation='old-owner' WHERE status='pending'")
      .run();
    assert.deepEqual((await bridge.handle('steer-poll', randomUUID(), p)).output, {});
    assert.equal(
      f.gateway.store.db
        .prepare("SELECT count(*) n FROM claude_hook_messages WHERE status='stale'")
        .get()!.n,
      1,
    );
  } finally {
    await f.close();
  }
});
