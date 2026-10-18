/** Publish pipeline output into an exact Relay session. No agent turn is created. */
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const args = process.argv.slice(2);
const options: Record<string, string> = {};
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--help') {
    console.log(
      'relay-artifact --session RELAY_OR_NATIVE_ID --file OUTPUT [--title TITLE] [--caption TEXT] [--host HOST_ID] [--request-id UUID]\nRELAY_URL: authenticated tailnet endpoint. RELAY_RESOLVE: optional curl HOST:PORT:IP override. RELAY_COOKIE_FILE: optional paired-device cookie jar outside the tailnet.',
    );
    process.exit(0);
  }
  if (
    !['--session', '--file', '--title', '--caption', '--host', '--request-id'].includes(args[i]) ||
    !args[i + 1]
  )
    throw new Error('Unknown or missing option. Use --help.');
  options[args[i].slice(2)] = args[++i];
}
const native = options.session || process.env.CODEX_THREAD_ID;
if (!native || !options.file)
  throw new Error('Specify --session and --file (Codex may use CODEX_THREAD_ID).');
let configured: string | undefined;
try {
  configured = JSON.parse(
    readFileSync(
      process.env.RC_CONFIG || path.join(process.env.HOME!, '.config/relay/config.json'),
      'utf8',
    ),
  ).tailnet?.endpoint;
} catch {
  /* Remote publishers set RELAY_URL. */
}
const base = new URL(process.env.RELAY_URL || configured || 'http://localhost:4080');
if (base.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(base.hostname))
  throw new Error('Remote publishing requires HTTPS.');
const common = ['--silent', '--show-error', '--fail-with-body', '--max-time', '120'];
if (process.env.RELAY_RESOLVE) common.push('--resolve', process.env.RELAY_RESOLVE);
else if (base.hostname.endsWith('.ts.net')) {
  try {
    const status = JSON.parse(
      execFileSync('tailscale', ['status', '--json'], { encoding: 'utf8' }),
    );
    const node = [status.Self, ...Object.values(status.Peer ?? {})].find(
      (n: any) => n?.DNSName?.replace(/\.$/, '') === base.hostname,
    );
    if (node?.TailscaleIPs?.[0])
      common.push('--resolve', `${base.hostname}:${base.port || '443'}:${node.TailscaleIPs[0]}`);
  } catch {
    /* Normal DNS remains available. */
  }
}
if (process.env.RELAY_COOKIE_FILE) common.push('--cookie', process.env.RELAY_COOKIE_FILE);
const request = (route: string, extra: string[] = []) => {
  try {
    return JSON.parse(
      execFileSync('curl', [...common, ...extra, new URL(route, base).href], {
        encoding: 'utf8',
        maxBuffer: 8 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
    );
  } catch {
    throw new Error(
      'Relay request failed. Check endpoint, device permissions, session identity, and retry with the same request ID.',
    );
  }
};
const sessions = request('/api/sessions').sessions.filter(
  (s: any) =>
    (s.id === native || s.nativeSessionId === native) &&
    (!options.host || s.hostId === options.host),
);
if (sessions.length !== 1)
  throw new Error(
    'Session is missing or ambiguous. Specify its exact Relay ID, or --host with its native ID.',
  );
const session = sessions[0];
const file = path.resolve(options.file);
if (!statSync(file).isFile() || statSync(file).size > 20 * 1024 * 1024)
  throw new Error('Artifact must be a regular file no larger than 20 MB.');
const bytes = readFileSync(file);
const name = path.basename(file),
  title = options.title || name,
  caption = options.caption || '';
const types: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.json': 'application/json',
  '.mp4': 'video/mp4',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
};
const mime = types[path.extname(file).toLowerCase()] || 'application/octet-stream';
const hash = createHash('sha256')
  .update(JSON.stringify([session.id, session.generation, name, title, caption, mime]))
  .update(bytes)
  .digest('hex');
const requestId =
  options['request-id'] ||
  `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
const query = new URLSearchParams({
  requestId,
  generation: session.generation,
  name,
  mime,
  title,
  caption,
});
// Send the same in-memory bytes used to compute the request identity.
try {
  const raw = execFileSync(
    'curl',
    [
      ...common,
      '-X',
      'POST',
      '-H',
      'Content-Type: application/octet-stream',
      '-H',
      'X-RC-Request: 1',
      '--data-binary',
      '@-',
      new URL(`/api/sessions/${encodeURIComponent(session.id)}/artifacts?${query}`, base).href,
    ],
    { input: bytes, maxBuffer: 8 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] },
  );
  const result = JSON.parse(raw.toString());
  console.log(
    JSON.stringify({
      eventId: result.event.id,
      requestId,
      url: new URL(`/?session=${encodeURIComponent(session.id)}`, base).href,
    }),
  );
} catch {
  throw new Error(
    `Artifact publication failed. Retry with the same file and --request-id ${requestId}.`,
  );
}
