import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.ts';
import { DshAdapter } from '../../adapters/src/dsh-session.ts';
import { DshClient } from '../../adapters/src/dsh.ts';
test('permission route requires control and explicit confirmation, rejects unsupported connections', async () => {
  const f = await fixture({ startRuntime: false });
  const url = `/api/sessions/${f.session.id}/permissions`;
  const request = { value: 'read-only', expected: 'workspace-write', confirm: true };
  try {
    assert.equal(
      (await f.gateway.app.inject({ method: 'GET', url, headers: f.headers })).json().supported,
      false,
    );
    const admin = f.gateway.auth.authenticate(f.headers.cookie.split('=')[1]);
    const token = f.gateway.auth.pair(f.gateway.auth.pairCode(admin), 'Reader');
    const reader = f.gateway.auth.authenticate(token.access);
    f.gateway.auth.grant(admin, reader.id, f.session.id, false);
    const headers = { ...f.headers, cookie: `rc_access=${token.access}` };
    assert.equal(
      (await f.gateway.app.inject({ method: 'POST', url, headers, payload: request })).statusCode,
      403,
    );
    assert.equal(
      (await f.gateway.app.inject({ method: 'POST', url, headers: f.headers, payload: request }))
        .statusCode,
      409,
    );
    const adapter = new DshAdapter(
      new DshClient('http://127.0.0.1', async () => ''),
      'http://127.0.0.1',
      async () => '',
      () => {},
    );
    let mutations = 0;
    adapter.setPermissions = async () => {
      mutations++;
      return { supported: true, current: 'read-only', options: [] };
    };
    f.gateway.runtime.adapters.set(f.session.id, adapter);
    assert.equal(
      (
        await f.gateway.app.inject({
          method: 'POST',
          url,
          headers: f.headers,
          payload: { ...request, confirm: false },
        })
      ).statusCode,
      400,
    );
    assert.equal(mutations, 0);
    assert.equal(
      (await f.gateway.app.inject({ method: 'POST', url, headers: f.headers, payload: request }))
        .statusCode,
      200,
    );
    assert.equal(mutations, 1);
  } finally {
    await f.close();
  }
});
