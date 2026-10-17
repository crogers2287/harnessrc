import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.ts';

test('native model API requires authorization, updates confirmed metadata, and creates no turn', async () => {
  const f = await fixture({ startRuntime: false });
  try {
    const s = f.session;
    const adapter = f.gateway.runtime.adapters.get(s.id)!;
    let model = 'old-model';
    const catalog = () => ({
      current: { provider: 'native', model },
      default: { provider: 'native', model },
      groups: [{ id: 'native', name: 'Native', models: [{ id: 'new-model', name: 'New model' }] }],
    });
    adapter.models = async () => catalog();
    adapter.setModel = async (_session, choice) => {
      model = choice.model;
      return catalog();
    };
    const url = `/api/sessions/${s.id}/models`;
    assert.equal((await f.gateway.app.inject({ url })).statusCode, 401);
    const read = await f.gateway.app.inject({ url, headers: f.headers });
    assert.equal(read.statusCode, 200, read.body);
    assert.equal(read.json().current.model, 'old-model');
    const write = await f.gateway.app.inject({
      method: 'POST',
      url: `/api/sessions/${s.id}/model`,
      headers: { ...f.headers, 'content-type': 'application/json' },
      payload: { provider: 'native', model: 'new-model' },
    });
    assert.equal(write.statusCode, 200, write.body);
    assert.equal(f.gateway.store.session(s.id).model, 'new-model');
    assert.equal(f.gateway.store.tasks(s.id).length, 0);
    assert.equal(f.mock.prompts.length, 0);
  } finally {
    await f.close();
  }
});
