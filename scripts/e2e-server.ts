import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { MockHarness } from '@harnessrc/testing';
import { createGateway } from '../apps/gateway/src/server.ts';
import { configSchema } from '../apps/gateway/src/config.ts';
const dir = await mkdtemp(path.join(tmpdir(), 'relay-e2e-'));
await mkdir('.data', { recursive: true, mode: 0o700 });
await writeFile('.data/e2e-directory', dir, { mode: 0o600 });
const mock = new MockHarness();
await mock.listen(path.join(dir, 'herdr.sock'), path.join(dir, 'native.sock'));
const config = configSchema.parse({
  dataDir: dir,
  origin: 'http://localhost:4080',
  hosts: [{ id: 'demo', name: 'Demo host', socket: path.join(dir, 'herdr.sock') }],
  bridges: [
    {
      hostId: 'demo',
      nativeSessionId: 'demo-codex',
      socket: path.join(dir, 'native.sock'),
      harness: 'mock',
    },
  ],
});
const { app } = await createGateway(config);
await app.listen({ host: '127.0.0.1', port: 4080 });
for (const signal of ['SIGTERM', 'SIGINT'])
  process.on(
    signal,
    () =>
      void app
        .close()
        .then(() => mock.close())
        .then(() => process.exit(0)),
  );
