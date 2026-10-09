import { randomUUID } from 'node:crypto';
import { z } from 'zod';

const responseSchema = z.object({
  type: z.literal('server-response'),
  rpcId: z.string(),
  result: z.discriminatedUnion('ok', [
    z.object({ ok: z.literal(true), value: z.unknown() }),
    z.object({ ok: z.literal(false), error: z.object({ code: z.string(), message: z.string() }) }),
  ]),
});

/** Native DSH Typert transport. Never starts another host or resumes via a second writer. */
export class DshClient {
  constructor(
    private endpoint: string,
    private credential: () => Promise<string>,
  ) {
    const url = new URL(endpoint);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search)
      throw new Error('Invalid DSH endpoint');
    if (url.protocol === 'http:' && !['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname))
      throw new Error('Remote DSH endpoints require HTTPS');
  }
  async call(method: string, args: Record<string, unknown>) {
    if (!/^session\/[a-zA-Z]+$/.test(method) && method !== 'agentPresets/list')
      throw new Error('Invalid DSH method');
    const rpcId = randomUUID();
    const cookie = await this.credential();
    if (!cookie || /[\r\n]/.test(cookie)) throw new Error('DSH authentication is not configured');
    const response = await fetch(new URL(`/api/${method}`, this.endpoint), {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ type: 'client-request', rpcId, method, payload: { args } }),
    });
    if (!response.ok) throw new Error(`DSH request failed (${response.status})`);
    const data = responseSchema.parse(await response.json());
    if (data.rpcId !== rpcId) throw new Error('DSH response identity mismatch');
    if (!data.result.ok) throw new Error(`DSH ${data.result.error.code}`);
    return data.result.value;
  }
  list() {
    return this.call('session/list', { _request: {} });
  }
  models() {
    return this.call('session/modelCatalog', {});
  }
  selectModel(sessionId: string, provider: string, model: string, reasoningEffort?: string) {
    return this.call('session/selectModel', {
      request: { sessionId, provider, model, ...(reasoningEffort ? { reasoningEffort } : {}) },
    });
  }
  /** Caller supplies its durable request ID; the native host deduplicates prompt admission. */
  prompt(sessionId: string, requestId: string, text: string, mode: 'queue' | 'steer') {
    if (!sessionId || !requestId || !text.trim()) throw new Error('DSH prompt is incomplete');
    return this.call('session/prompt', {
      request: { sessionId, requestId, mode, content: [{ type: 'text', text }] },
    });
  }
}

/** Exchange the native host's private launch token; keep its cookie only in memory. */
export function dshCredential(endpoint: string, tokenFile: string) {
  let token = '',
    cookie = '';
  return async () => {
    const { readFile, stat } = await import('node:fs/promises');
    const info = await stat(tokenFile);
    if (info.uid !== process.getuid?.() || info.mode & 0o077)
      throw new Error('DSH token file must be private to the gateway account');
    const next = (await readFile(tokenFile, 'utf8')).trim();
    if (!/^[A-Za-z0-9_-]{43}$/.test(next)) throw new Error('DSH login token is unavailable');
    if (token === next && cookie) return cookie;
    const url = new URL('/', endpoint);
    url.searchParams.set('token', next);
    const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(10000) });
    const value = response.headers.get('set-cookie')?.split(';')[0];
    if (![302, 303].includes(response.status) || !value?.startsWith('dsh-auth-'))
      throw new Error('DSH native login failed');
    token = next;
    cookie = value;
    return cookie;
  };
}
