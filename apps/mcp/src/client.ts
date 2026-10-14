import { readFile, stat } from 'node:fs/promises';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';

/** MCP is a client of the existing authenticated API, never a second harness owner. */
export class RelayClient {
  readonly origin: string;
  constructor(
    url: string,
    private options: {
      cookieFile?: string;
      connectIp?: string;
      timeoutMs?: number;
      fetch?: (url: string, init: RequestInit) => Promise<Response>;
    } = {},
  ) {
    const u = new URL(url);
    if (u.username || u.password || u.search || u.hash || u.pathname !== '/')
      throw new Error('RELAY_URL must be an origin without credentials, query or path');
    if (
      u.protocol !== 'https:' &&
      !(u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname))
    )
      throw new Error('Relay requires HTTPS outside loopback');
    this.origin = u.origin;
    if (options.connectIp && (u.protocol !== 'https:' || !isIP(options.connectIp)))
      throw new Error('RELAY_CONNECT_IP requires HTTPS and a valid IP address');
  }
  /** Override DNS only: SNI, Host and certificate identity remain the configured HTTPS host. */
  private pinnedFetch(url: string, init: RequestInit): Promise<Response> {
    const target = new URL(url);
    return new Promise((resolve, reject) => {
      const request = httpsRequest(
        target,
        {
          hostname: this.options.connectIp,
          servername: target.hostname,
          method: init.method,
          headers: { ...(init.headers as Record<string, string>), host: target.host },
          signal: init.signal ?? undefined,
        },
        (response) => {
          const chunks: Buffer[] = [];
          let size = 0;
          response.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > 4 * 1024 * 1024) {
              const error = new Error('Relay response too large; request a smaller page');
              reject(error);
              response.destroy(error);
              return;
            }
            chunks.push(chunk);
          });
          response.on('error', reject);
          response.on('end', () =>
            resolve(new Response(Buffer.concat(chunks), { status: response.statusCode ?? 500 })),
          );
        },
      );
      request.on('error', reject);
      request.end(init.body as string | Uint8Array | undefined);
    });
  }
  async request(route: string, method = 'GET', body?: unknown, generation?: string) {
    if (!route.startsWith('/api/')) throw new Error('Not a Relay API route');
    const headers: Record<string, string> = { origin: this.origin, 'x-rc-request': '1' };
    if (generation) headers['x-rc-generation'] = generation;
    if (this.options.cookieFile) {
      const info = await stat(this.options.cookieFile);
      if (!info.isFile() || (process.platform !== 'win32' && info.mode & 0o077))
        throw new Error('Relay cookie file must be private (0600)');
      if (info.size > 4096) throw new Error('Invalid Relay cookie file');
      const value = (await readFile(this.options.cookieFile, 'utf8')).trim();
      if (!/^rc_access=[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid Relay cookie file');
      headers.cookie = value;
    }
    const binary = Buffer.isBuffer(body);
    if (body !== undefined)
      headers['content-type'] = binary ? 'application/octet-stream' : 'application/json';
    const fetcher =
      this.options.fetch ?? (this.options.connectIp ? this.pinnedFetch.bind(this) : fetch);
    const response = await fetcher(this.origin + route, {
      method,
      headers,
      redirect: 'error',
      signal: AbortSignal.timeout(this.options.timeoutMs ?? 20000),
      body:
        body === undefined
          ? undefined
          : binary
            ? new Uint8Array(body as Buffer)
            : JSON.stringify(body),
    });
    // Bound even chunked responses; transcripts should be paged, never downloaded wholesale.
    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (reader) {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > 4 * 1024 * 1024)
            throw new Error('Relay response too large; request a smaller page');
          chunks.push(value);
        }
      } finally {
        await reader.cancel();
      }
    }
    let data: any;
    try {
      data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      throw new Error(
        `Relay returned non-JSON (HTTP ${response.status}); check endpoint and Tailscale`,
      );
    }
    if (!response.ok)
      throw new Error(`Relay HTTP ${response.status}: ${data.error ?? 'Request failed'}`);
    return data;
  }
}
