import { randomUUID } from 'node:crypto';
import { z } from 'zod';

const responseSchema = z.object({
  type: z.literal('server-response'),
  rpcId: z.string(),
  result: z.discriminatedUnion('ok', [
    z.object({ ok: z.literal(true), value: z.unknown().optional() }),
    z.object({ ok: z.literal(false), error: z.object({ code: z.string(), message: z.string() }) }),
  ]),
});

export type DshContent =
  | { type: 'text'; text: string }
  | { type: 'image'; mediaType: string; data: string; name: string }
  | { type: 'file'; receiptId: string };
export type DshAttachment = { name: string; mime: string; bytes: Buffer };

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
    if (
      !/^session\/[a-zA-Z]+$/.test(method) &&
      method !== 'agentPresets/list' &&
      method !== '$events/result'
    )
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
    if (!data.result.ok) {
      // Give a useful model-selection error without exposing arbitrary native diagnostics.
      if (data.result.error.code === 'session/attachment-invalid')
        throw new Error(
          'DSH rejected the attachment. Check the file format and select an image-capable model for images.',
        );
      throw new Error(`DSH ${data.result.error.code}`);
    }
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
  /** Non-mutating feature probe: the installed binary owns this route. */
  async supportsAttachments() {
    const cookie = await this.credential();
    if (!cookie || /[\r\n]/.test(cookie)) return false;
    const url = new URL('/api/session/uploadFileBinary', this.endpoint);
    const { request } = await import(url.protocol === 'https:' ? 'node:https' : 'node:http');
    // Native admission can close a rejected Fetch body early. Use a zero-length
    // HTTP request for this probe; it cannot resolve an agent or store bytes.
    return new Promise<boolean>((resolve) => {
      const req = request(
        url,
        {
          method: 'POST',
          headers: {
            Cookie: cookie,
            'Content-Type': 'application/octet-stream',
            'Content-Length': '0',
          },
        },
        (res) => {
          let text = '';
          res.on('data', (chunk) => {
            if (text.length < 1024) text += chunk.toString();
          });
          res.on('end', () => resolve(res.statusCode === 400 && text === 'sessionId is required'));
          res.on('error', () => resolve(false));
        },
      );
      req.setTimeout(10000, () => req.destroy());
      req.on('error', () => resolve(false));
      req.end();
    });
  }
  /** DSH's authenticated raw-byte upload returns a session-scoped file receipt. */
  async upload(sessionId: string, file: DshAttachment) {
    const cookie = await this.credential();
    if (!cookie || /[\r\n]/.test(cookie)) throw new Error('DSH authentication is not configured');
    const url = new URL('/api/session/uploadFileBinary', this.endpoint);
    url.search = new URLSearchParams({ sessionId, name: file.name }).toString();
    const response = await fetch(url, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(30000),
      headers: { 'Content-Type': 'application/octet-stream', Cookie: cookie },
      body: new Uint8Array(file.bytes),
    });
    if (!response.ok) throw new Error(`DSH file upload failed (${response.status})`);
    const result = z
      .discriminatedUnion('ok', [
        z.object({ ok: z.literal(true), value: z.object({ receiptId: z.string().min(1) }) }),
        z.object({ ok: z.literal(false), error: z.object({ code: z.string() }) }),
      ])
      .parse(await response.json());
    if (!result.ok) throw new Error(`DSH file upload rejected (${result.error.code})`);
    return result.value.receiptId;
  }
  async content(sessionId: string, text: string, files: DshAttachment[]): Promise<DshContent[]> {
    const content: DshContent[] = text.trim() ? [{ type: 'text', text }] : [];
    for (const file of files) {
      if (['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.mime))
        content.push({
          type: 'image',
          mediaType: file.mime,
          data: file.bytes.toString('base64'),
          name: file.name,
        });
      else content.push({ type: 'file', receiptId: await this.upload(sessionId, file) });
    }
    return content;
  }
  /** Caller supplies its durable request ID; the native host deduplicates prompt admission. */
  prompt(
    sessionId: string,
    requestId: string,
    input: string | DshContent[],
    mode: 'queue' | 'steer',
  ) {
    const content = typeof input === 'string' ? [{ type: 'text' as const, text: input }] : input;
    if (!sessionId || !requestId || !content.some((p) => p.type !== 'text' || p.text.trim()))
      throw new Error('DSH prompt is incomplete');
    return this.call('session/prompt', { request: { sessionId, requestId, mode, content } }).then(
      (value) => {
        z.object({ accepted: z.literal(true) }).parse(value);
      },
    );
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
