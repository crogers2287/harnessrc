import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.ts';

test('live questions remain available when transcript import fails', async () => {
  const f = await fixture({ startRuntime: false });
  try {
    const { runtime, store } = f.gateway;
    runtime.refresh = async () => {};
    const adapter = runtime.adapters.get(f.session.id)!;
    adapter.read = async () => {
      throw new Error('Transcript exceeds import limit');
    };
    adapter.interactions = async () => [
      {
        nativeRequestId: 'native-question',
        type: 'free-text',
        prompt: 'Which phone?',
        choices: [],
        responseSchema: { type: 'string', minLength: 1 },
        route: 'mock',
        metadata: {},
        expiresAt: '2100-01-01T00:00:00.000Z',
      },
    ];
    await runtime.tick();
    assert.equal(store.interactions(f.session.id).length, 1);
    assert.equal(store.interactions(f.session.id)[0].status, 'pending');
    assert.equal(store.session(f.session.id).diagnostic, 'Transcript exceeds import limit');
    await runtime.tick();
    assert.equal(store.interactions(f.session.id).length, 1);
  } finally {
    await f.close();
  }
});
