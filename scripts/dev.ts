import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
const dir = path.resolve('.data/demo');
mkdirSync(dir, { recursive: true, mode: 0o700 });
const file = path.join(dir, 'config.json');
writeFileSync(
  file,
  JSON.stringify(
    {
      dataDir: dir,
      origin: 'http://localhost:4080',
      hosts: [{ id: 'demo', name: 'Demo host', socket: path.join(dir, 'herdr.sock') }],
      bridges: [
        {
          hostId: 'demo',
          nativeSessionId: 'demo-codex',
          socket: path.join(dir, 'codex.sock'),
          harness: 'mock',
        },
      ],
    },
    null,
    2,
  ),
);
if (!existsSync('apps/web/dist/index.html'))
  await new Promise<void>((resolve, reject) => {
    const build = spawn('npm', ['run', 'build'], { stdio: 'inherit' });
    build.on('exit', (code) => (code ? reject(new Error('Build failed')) : resolve()));
  });
const children = [spawn('node', ['--import', 'tsx', 'scripts/mock.ts'], { stdio: 'inherit' })];
await new Promise((r) => setTimeout(r, 700));
children.push(
  spawn('node', ['--import', 'tsx', 'apps/gateway/src/main.ts'], {
    stdio: 'inherit',
    env: { ...process.env, RC_CONFIG: file },
  }),
);
console.log(
  'Demo: http://localhost:4080 — pairing key is in .data/demo/pairing-key. Ask for “approval” or “question” to demonstrate interactions.',
);
let stopping = false;
const stop = () => {
  if (stopping) return;
  stopping = true;
  for (const c of children) c.kill('SIGTERM');
};
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, stop);
for (const c of children) c.on('exit', () => stop());
