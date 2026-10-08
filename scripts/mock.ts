import { MockHarness } from '@harnessrc/testing';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
const dir = path.resolve(process.env.RC_DATA_DIR ?? '.data/demo');
mkdirSync(dir, { recursive: true, mode: 0o700 });
const mock = new MockHarness();
await mock.listen(path.join(dir, 'herdr.sock'), path.join(dir, 'codex.sock'));
console.log('Mock Herdr and native harness ready.');
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => void mock.close().then(() => process.exit(0)));
