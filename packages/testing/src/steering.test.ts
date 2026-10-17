import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '@harnessrc/storage';
import { deliverSteer } from '../../../apps/gateway/src/steering.ts';

test('steer claims before delivery, rejects parallel replay, and replays confirmation', async () => {
  const store = new Store(':memory:');
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let calls = 0;
  const deliver = async () => {
    calls++;
    await held;
  };
  try {
    const first = deliverSteer(store, 'key', 'device', 'session', 'hello', deliver);
    await assert.rejects(
      () => deliverSteer(store, 'key', 'device', 'session', 'hello', deliver),
      /not confirmed/,
    );
    release();
    await first;
    assert.deepEqual(await deliverSteer(store, 'key', 'device', 'session', 'hello', deliver), {
      ok: true,
    });
    await assert.rejects(
      () => deliverSteer(store, 'key', 'device', 'other', 'hello', deliver),
      /conflicts/,
    );
    await assert.rejects(
      () => deliverSteer(store, 'key', 'other', 'session', 'hello', deliver),
      /conflicts/,
    );
    await assert.rejects(
      () => deliverSteer(store, 'key', 'device', 'session', 'changed', deliver),
      /conflicts/,
    );
    assert.equal(calls, 1);
  } finally {
    store.db.close();
  }
});

test('lost steer confirmation and interrupted claims never cause a second delivery', async () => {
  const store = new Store(':memory:');
  let calls = 0;
  const deliver = async () => {
    calls++;
    throw new Error('Connection lost after delivery');
  };
  try {
    await assert.rejects(() => deliverSteer(store, 'lost', 'device', 'session', 'hello', deliver));
    await assert.rejects(
      () => deliverSteer(store, 'lost', 'device', 'session', 'hello', deliver),
      /not confirmed/,
    );
    store.db.prepare("UPDATE steering_receipts SET status='sending'").run();
    await assert.rejects(
      () => deliverSteer(store, 'lost', 'device', 'session', 'hello', deliver),
      /not confirmed/,
    );
    assert.equal(calls, 1);
  } finally {
    store.db.close();
  }
});
