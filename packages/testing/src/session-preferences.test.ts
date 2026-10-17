import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.ts';
test('session names, pinning and history survive rediscovery and restart without controlling the agent', async () => {
  const f = await fixture({ startRuntime: false });
  try {
    const url = `/api/sessions/${f.session.id}/preferences`;
    assert.equal(
      (await f.gateway.app.inject({ method: 'PATCH', url, payload: { name: 'New' } })).statusCode,
      403,
    );
    const result = await f.gateway.app.inject({
      method: 'PATCH',
      url,
      headers: f.headers,
      payload: { name: 'Phone project', pinned: true, archived: true },
    });
    assert.equal(result.statusCode, 200);
    await f.gateway.runtime.refresh('test');
    await f.restart();
    const value = (
      await f.gateway.app.inject({
        url: '/api/sessions',
        headers: f.headers,
      })
    ).json().sessions[0];
    assert.equal(value.relayName, 'Phone project');
    assert.equal(value.archived, true);
    assert.equal(value.pinned, true);
    assert.equal(f.mock.prompts.length, 0);
  } finally {
    await f.close();
  }
});
