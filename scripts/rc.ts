/** Local registration/status helper. Does not install or override any harness slash command. */
import { readFileSync, writeFileSync } from 'node:fs';
import { loadConfig } from '../apps/gateway/src/config.ts';
import { HerdrClient } from '@harnessrc/herdr';
const command = process.argv[2] ?? 'status';
const config = loadConfig();
if (command === 'status') {
  for (const h of config.hosts) {
    try {
      const c = new HerdrClient(h.id, h.socket);
      const s = await c.snapshot();
      console.log(
        JSON.stringify({
          host: h.name,
          connected: true,
          version: c.host.version,
          agents: s.agents.length,
          nativeBound: s.agents.filter((a) => a.agent_session).length,
        }),
      );
    } catch (e) {
      console.log(JSON.stringify({ host: h.name, connected: false, error: (e as Error).message }));
    }
  }
} else if (command === 'register') {
  const [hostId, nativeSessionId, socket] = process.argv.slice(3);
  if (!hostId || !nativeSessionId || !socket || !process.env.RC_CONFIG)
    throw new Error(
      'Usage: RC_CONFIG=config.json npm exec tsx scripts/rc.ts register HOST NATIVE_SESSION SOCKET',
    );
  if (!config.hosts.some((h) => h.id === hostId)) throw new Error('Unknown host');
  const file = process.env.RC_CONFIG;
  const body = JSON.parse(readFileSync(file, 'utf8'));
  body.bridges = (body.bridges ?? []).filter(
    (b: any) => !(b.hostId === hostId && b.nativeSessionId === nativeSessionId),
  );
  body.bridges.push({ hostId, nativeSessionId, socket, harness: 'codex' });
  writeFileSync(file, JSON.stringify(body, null, 2) + '\n', { mode: 0o600 });
  console.log('Native bridge registered. Restart the gateway to apply configuration.');
} else throw new Error('Supported commands: status, register. Native /rc is untouched.');
