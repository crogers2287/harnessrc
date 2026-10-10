import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../apps/gateway/src/config.ts';
import { HerdrClient } from '@harnessrc/herdr';
const config = loadConfig();
const report: any = {
  node: process.versions.node,
  checkedAt: new Date().toISOString(),
  hosts: [],
  checks: [],
};
try {
  report.herdrVersion = execFileSync('herdr', ['--version'], { encoding: 'utf8' }).trim();
  const raw = execFileSync('herdr', ['api', 'schema', '--json'], {
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
  const schema = JSON.parse(raw);
  report.herdrProtocol = schema.protocol;
  const methods = new Set(
    schema.schemas.request.oneOf.map((x: any) => x.properties?.method?.const),
  );
  for (const method of [
    'session.snapshot',
    'events.subscribe',
    'agent.get',
    'pane.process_info',
    'pane.report_agent_session',
    'pane.report_agent',
  ])
    report.checks.push({ method, available: methods.has(method) });
  mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
  writeFileSync(path.join(config.dataDir, 'installed-herdr.schema.json'), raw, { mode: 0o600 });
} catch (e) {
  report.herdrError = (e as Error).message;
}
try {
  report.codexVersion = execFileSync('codex', ['--version'], { encoding: 'utf8' }).trim();
  const out = path.join(config.dataDir, 'codex-protocol');
  execFileSync('codex', ['app-server', 'generate-json-schema', '--out', out], {
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
  });
  report.codexSchemaDirectory = out;
} catch (e) {
  report.codexError = (e as Error).message;
}
for (const h of config.hosts) {
  const check: any = { id: h.id, socket: h.socket };
  try {
    const s = statSync(h.socket);
    check.isSocket = s.isSocket();
    check.privatePermissions = (s.mode & 0o077) === 0;
    check.sameUser = s.uid === process.getuid?.();
    if (process.argv.includes('--live')) {
      const client = new HerdrClient(h.id, h.socket);
      const snapshot = await client.snapshot();
      check.connected = true;
      check.version = client.host.version;
      check.protocol = client.host.protocol;
      check.agentCount = snapshot.agents.length;
      check.nativeBoundCount = snapshot.agents.filter((a) => a.agent_session).length;
    }
  } catch (e) {
    check.error = (e as Error).message;
  }
  report.hosts.push(check);
}
console.log(JSON.stringify(report, null, 2));
if (report.checks.some((c: any) => !c.available) || report.herdrError) process.exitCode = 1;
