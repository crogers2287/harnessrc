import http, { type IncomingMessage } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { isIP } from 'node:net';
import type { FastifyInstance } from 'fastify';
const execute = promisify(execFile);
const privateIngress = Symbol('tailscale-private-listener');
type PrivateRequest = IncomingMessage & { [privateIngress]?: boolean };
export type TailnetNode = { id: string; name: string };
export async function whois(ip: string): Promise<TailnetNode> {
  const { stdout } = await execute('tailscale', ['whois', '--json', ip], {
    timeout: 3000,
    maxBuffer: 65536,
  });
  const data = JSON.parse(stdout);
  if (
    !data.Node?.StableID ||
    !data.Node.Addresses?.some((address: string) => address.split('/')[0] === ip)
  )
    throw new Error('Unverified Tailscale peer');
  return { id: data.Node.StableID, name: data.Node.Name };
}
export class TailnetAuth {
  private cache = new Map<string, { until: number; node: TailnetNode }>();
  constructor(private lookup = whois) {}
  async identify(raw: IncomingMessage): Promise<TailnetNode | undefined> {
    if (!(raw as PrivateRequest)[privateIngress]) return;
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(raw.socket.remoteAddress ?? '')) return;
    // Tailscale Serve overwrites this header with the encrypted connection's actual peer.
    const ip = raw.headers['x-forwarded-for'];
    if (typeof ip !== 'string' || !isIP(ip)) throw new Error('Missing Tailscale peer');
    const cached = this.cache.get(ip);
    if (cached && cached.until > Date.now()) return cached.node;
    const node = await this.lookup(ip);
    this.cache.set(ip, { until: Date.now() + 10000, node });
    if (this.cache.size > 1024) this.cache.delete(this.cache.keys().next().value!);
    return node;
  }
}
/** Only the separate loopback listener is trusted. Public proxy headers never authenticate. */
export async function listenTailnet(app: FastifyInstance, port: number) {
  await app.ready();
  const server = http.createServer((req, res) => {
    (req as PrivateRequest)[privateIngress] = true;
    app.server.emit('request', req, res);
  });
  server.on('upgrade', (req, socket, head) => {
    (req as PrivateRequest)[privateIngress] = true;
    app.server.emit('upgrade', req, socket, head);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve());
  });
  return server;
}
