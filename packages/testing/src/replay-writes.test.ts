import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.ts';

test('native replay neither writes duplicate rows nor advances SQLite sequence', async () => {
  const f = await fixture({ startRuntime: false });
  try {
    const store = f.gateway.store;
    const source = {
      sourceId: 'replay-proof',
      kind: 'assistant.message' as const,
      timestamp: new Date().toISOString(),
      data: { text: 'An immutable answer', model: 'fixture-model' },
    };
    const original = store.event(f.session, source);
    const writes = () => store.db.prepare('SELECT total_changes() AS n').get()!.n;
    const sequence = () =>
      store.db.prepare("SELECT seq FROM sqlite_sequence WHERE name='events'").get()!.seq;
    const beforeWrites = writes(),
      beforeSequence = sequence();
    let emitted = 0;
    store.on('event', () => emitted++);
    for (let i = 0; i < 2000; i++) assert.deepEqual(store.event(f.session, source), original);
    assert.equal(writes(), beforeWrites);
    assert.equal(sequence(), beforeSequence);
    assert.equal(emitted, 0);
    const next = store.event(f.session, { ...source, sourceId: 'next-event' });
    assert.equal(next.sequence, original.sequence + 1);
    assert.equal(emitted, 1);
  } finally {
    await f.close();
  }
});
