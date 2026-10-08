import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { MockHarness } from './mock.ts';
import { configSchema } from '../../../apps/gateway/src/config.ts';
import { createGateway } from '../../../apps/gateway/src/server.ts';
export async function eventually(fn: () => boolean | Promise<boolean>, timeout = 6000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('Condition did not become true before deadline');
}
export async function fixture(options: { harness?: string; startRuntime?: boolean } = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'relay-'));
  const mock = new MockHarness();
  if (options.harness) mock.harness = options.harness;
  await mock.listen(path.join(dir, 'herdr.sock'), path.join(dir, 'native.sock'));
  const config = configSchema.parse({
    dataDir: dir,
    origin: 'http://localhost:4080',
    hosts: [{ id: 'test', name: 'Test host', socket: path.join(dir, 'herdr.sock') }],
    bridges:
      options.harness === 'claude'
        ? []
        : [
            {
              hostId: 'test',
              nativeSessionId: mock.sessionId,
              socket: path.join(dir, 'native.sock'),
              harness: 'mock',
            },
          ],
    transcripts: { claude: dir, codex: dir, omp: dir, hermes: path.join(dir, 'hermes.db') },
  });
  let gateway = await createGateway(config, { startRuntime: options.startRuntime !== false });
  if (options.startRuntime === false) {
    gateway.runtime.clients.get('test')!.host.connected = true;
    await gateway.runtime.refresh('test');
  } else await eventually(() => gateway.store.sessions().length > 0);
  const tokens = gateway.auth.pair(gateway.auth.pairingKey, 'Test browser');
  const headers = { cookie: `rc_access=${tokens.access}`, 'x-rc-request': '1' };
  return {
    dir,
    mock,
    config,
    headers,
    get gateway() {
      return gateway;
    },
    get session() {
      return gateway.store.sessions().find((s) => s.nativeSessionId === mock.sessionId)!;
    },
    async restart() {
      await gateway.app.close();
      gateway = await createGateway(config);
      await eventually(() => gateway.store.sessions().some((s) => s.connected));
    },
    async close() {
      await gateway.app.close();
      await mock.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}
