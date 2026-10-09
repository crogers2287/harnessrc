import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fixture } from './helpers.ts';
test('Android download is authenticated and only exposes the published package', async () => {
  const f = await fixture({ startRuntime: false });
  try {
    const { app } = f.gateway;
    assert.equal((await app.inject('/api/android/apk')).statusCode, 401);
    assert.equal(
      (await app.inject({ url: '/api/android/apk', headers: f.headers })).statusCode,
      404,
    );
    const directory = path.join(f.dir, 'android');
    mkdirSync(directory);
    const bytes = Buffer.from('apk-fixture');
    writeFileSync(path.join(directory, 'relay.apk'), bytes);
    writeFileSync(
      path.join(directory, 'release.json'),
      JSON.stringify({
        version: '0.1.0',
        sha256: createHash('sha256').update(bytes).digest('hex'),
      }),
    );
    const metadata = await app.inject({ url: '/api/android', headers: f.headers });
    assert.equal(metadata.json().available, true);
    const download = await app.inject({ url: '/api/android/apk', headers: f.headers });
    assert.equal(download.statusCode, 200);
    assert.equal(download.headers['content-type'], 'application/vnd.android.package-archive');
    assert.equal(download.body, 'apk-fixture');
  } finally {
    await f.close();
  }
});
