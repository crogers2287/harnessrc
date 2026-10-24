import { helperCompletion } from './helper-proxy.ts';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Store } from '@harnessrc/storage';

export const helperConnectionSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  label: z.string(),
  baseUrl: z.string().url(),
  apiKeyEnv: z.string().optional(),
  defaultModel: z.string().optional(),
  allowCustomModel: z.boolean().default(false),
  models: z.array(z.object({ id: z.string(), name: z.string() })).default([]),
});
export type HelperConnection = z.infer<typeof helperConnectionSchema>;
export const helperRequestSchema = z
  .object({
    requestId: z.string().uuid(),
    profileId: z.string(),
    model: z.string().min(1).max(160),
    prompt: z.string().trim().min(1).max(32000),
    replace: z.boolean().default(false),
  })
  .strict();
export const helperMessageSchema = z
  .object({
    requestId: z.string().uuid(),
    conversationId: z.string().uuid(),
    prompt: z.string().trim().min(1).max(32000),
  })
  .strict();
export const HELPER_INSTRUCTIONS = readFileSync(
  new URL('../../../docs/HELPER_PROMPT.md', import.meta.url),
  'utf8',
);
export type HelperTools = {
  list: { name: string; description?: string; inputSchema: unknown }[];
  call: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  close: () => Promise<void>;
};
type Chat = {
  id: string;
  requestId: string;
  profileId: string;
  model: string;
  status: 'running' | 'idle' | 'stopped' | 'error';
  error?: string;
  messages: any[];
  usage?: { input: number; output: number; total: number };
};
const conflict = (message: string) => Object.assign(new Error(message), { statusCode: 409 });

/** Private app agent: no harness launch, native transcript, pane, or ordinary Session. */
export class HelperConversations {
  private jobs = new Set<Promise<void>>();
  private running = new Map<string, AbortController>();
  private catalogs = new Map<string, { at: number; models: HelperConnection['models'] }>();
  constructor(
    private store: Store,
    private connections: HelperConnection[],
    private fetcher: (url: string, init?: RequestInit) => Promise<Response> = fetch,
  ) {
    store.db.exec(`CREATE TABLE IF NOT EXISTS helper_chats (
      id TEXT PRIMARY KEY,device_id TEXT NOT NULL,body TEXT NOT NULL,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS helper_requests (
      id TEXT PRIMARY KEY,device_id TEXT NOT NULL,conversation_id TEXT NOT NULL,body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS helper_current (device_id TEXT PRIMARY KEY,conversation_id TEXT NOT NULL)`);
    // A restart must not replay model turns or tool mutations.
    for (const row of store.db.prepare('SELECT body FROM helper_chats').all()) {
      const chat = JSON.parse(row.body as string) as Chat;
      if (chat.status === 'running') {
        chat.status = 'stopped';
        chat.error = 'Gateway restarted. Previous actions were not replayed.';
        this.save(chat);
      }
    }
  }
  legacySessionIds(): Set<string> {
    // Migrate only identities proven by this feature's old binding and launch
    // receipt. Preserve the native process, transcript and direct history URL.
    const exists = this.store.db
      .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='helper_bindings'")
      .get();
    if (!exists) return new Set();
    const receipts = this.store.db
      .prepare('SELECT l.receipt FROM launches l JOIN helper_bindings h ON h.request_id=l.id')
      .all();
    const ids = new Set<string>();
    for (const row of receipts) {
      const r = JSON.parse(row.receipt as string);
      for (const session of this.store.sessions()) {
        if (
          session.hostId === r.hostId &&
          session.ownership === 'herdr-cli' &&
          (r.nativeSessionId
            ? session.nativeSessionId === r.nativeSessionId
            : r.terminalId && session.terminalId === r.terminalId)
        )
          ids.add(session.id);
      }
    }
    return ids;
  }
  private save(chat: Chat) {
    this.store.db
      .prepare('UPDATE helper_chats SET body=? WHERE id=?')
      .run(JSON.stringify(chat), chat.id);
  }
  private current(device: string): Chat | null {
    const row = this.store.db
      .prepare(
        'SELECT body FROM helper_chats WHERE id=(SELECT conversation_id FROM helper_current WHERE device_id=?) AND device_id=?',
      )
      .get(device, device);
    return row ? JSON.parse(row.body as string) : null;
  }
  private async models(p: HelperConnection) {
    const cached = this.catalogs.get(p.id);
    if (cached && Date.now() - cached.at < 60000) return cached.models;
    try {
      const response = await this.fetcher(p.baseUrl.replace(/\/$/, '') + '/models', {
        headers: this.headers(p),
        signal: AbortSignal.timeout(3000),
        redirect: 'error',
      });
      if (!response.ok) return p.models;
      const body = z
        .object({ data: z.array(z.object({ id: z.string().min(1).max(160) })).max(2000) })
        .parse(await response.json());
      const models = body.data.map((m) => ({ id: m.id, name: m.id }));
      this.catalogs.set(p.id, { at: Date.now(), models });
      return models;
    } catch {
      return p.models;
    }
  }
  private headers(p: HelperConnection): Record<string, string> {
    const key = p.apiKeyEnv ? process.env[p.apiKeyEnv] : undefined;
    if (p.apiKeyEnv && !key) throw new Error('Helper proxy credentials are not configured');
    return {
      'content-type': 'application/json',
      ...(key ? { authorization: `Bearer ${key}` } : {}),
    };
  }
  async view(device: string) {
    const profiles = await Promise.all(
      this.connections.map(async (p) => ({
        id: p.id,
        label: p.label,
        provider: 'Proxy',
        models: await this.models(p),
        defaultModel: p.defaultModel,
        allowCustomModel: p.allowCustomModel,
        connected: !p.apiKeyEnv || !!process.env[p.apiKeyEnv],
      })),
    );
    const current = this.current(device);
    return {
      profiles,
      current: current
        ? {
            ...current,
            messages: current.messages
              .filter((m) => m.role === 'user' || (m.role === 'assistant' && m.content))
              .map((m) => ({ role: m.role, content: m.content })),
            receipt: { status: 'started' },
          }
        : null,
    };
  }
  async start(body: unknown, device: string, tools: () => Promise<HelperTools>) {
    const input = helperRequestSchema.parse(body);
    const previous = this.replay(input.requestId, device, input);
    if (previous) return previous;
    const p = this.connections.find((p) => p.id === input.profileId);
    if (!p) throw new Error('Choose an enabled helper connection');
    if (!(await this.models(p)).some((m) => m.id === input.model) && !p.allowCustomModel)
      throw new Error('Choose an available proxy model');
    this.headers(p);
    // Recheck after asynchronous catalog discovery, before the synchronous claim.
    const replay = this.replay(input.requestId, device, input);
    if (replay) return replay;
    const old = this.current(device);
    if (old?.status === 'running') throw conflict('Stop the current helper turn first');
    if (old && !input.replace)
      throw conflict('A helper conversation already exists. Reopen it or choose New conversation.');
    const chat: Chat = {
      id: randomUUID(),
      requestId: input.requestId,
      profileId: p.id,
      model: input.model,
      status: 'running',
      messages: [{ role: 'user', content: input.prompt }],
    };
    this.store.transaction(() => {
      this.store.db
        .prepare('INSERT INTO helper_chats VALUES(?,?,?,?)')
        .run(chat.id, device, JSON.stringify(chat), new Date().toISOString());
      this.store.db
        .prepare(
          'INSERT INTO helper_current VALUES(?,?) ON CONFLICT(device_id) DO UPDATE SET conversation_id=excluded.conversation_id',
        )
        .run(device, chat.id);
      this.claim(input.requestId, device, chat.id, input);
    });
    this.run(chat, p, tools);
    return { requestId: input.requestId, conversationId: chat.id, status: 'started' };
  }
  private claim(id: string, device: string, conversation: string, body: unknown) {
    this.store.db
      .prepare('INSERT INTO helper_requests VALUES(?,?,?,?)')
      .run(id, device, conversation, JSON.stringify(body));
  }
  private replay(id: string, device: string, body: unknown) {
    const row = this.store.db.prepare('SELECT * FROM helper_requests WHERE id=?').get(id);
    if (!row) return null;
    if (row.device_id !== device || row.body !== JSON.stringify(body))
      throw conflict('This helper request ID was already used for different settings');
    return { requestId: id, conversationId: row.conversation_id as string, status: 'started' };
  }
  async message(body: unknown, device: string, tools: () => Promise<HelperTools>) {
    const input = helperMessageSchema.parse(body);
    const replay = this.replay(input.requestId, device, input);
    if (replay) return replay;
    const chat = this.current(device);
    if (!chat || chat.id !== input.conversationId)
      throw conflict('Reopen the current helper conversation');
    if (chat.status === 'running') throw conflict('The helper is still working');
    const p = this.connections.find((p) => p.id === chat.profileId);
    if (!p) throw new Error('Helper connection unavailable');
    const completed = new Set(
      chat.messages.filter((m) => m.role === 'tool').map((m) => m.tool_call_id),
    );
    for (const message of chat.messages)
      for (const call of message.tool_calls ?? []) {
        if (!completed.has(call.id))
          chat.messages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: JSON.stringify({
              isError: true,
              message:
                'Turn interrupted before a tool receipt was saved. Inspect current state before retrying.',
            }),
          });
      }
    chat.messages.push({ role: 'user', content: input.prompt });
    chat.status = 'running';
    delete chat.error;
    this.store.transaction(() => {
      this.claim(input.requestId, device, chat.id, input);
      this.save(chat);
    });
    this.run(chat, p, tools);
    return { requestId: input.requestId, conversationId: chat.id, status: 'started' };
  }
  stop(device: string) {
    const chat = this.current(device);
    if (chat) this.running.get(chat.id)?.abort();
    return { status: 'stopping' };
  }
  async close() {
    for (const controller of this.running.values()) controller.abort();
    await Promise.allSettled(this.jobs);
  }
  private run(chat: Chat, p: HelperConnection, tools: () => Promise<HelperTools>) {
    const controller = new AbortController();
    this.running.set(chat.id, controller);
    const job = (async () => {
      let bridge: HelperTools | undefined;
      try {
        bridge = await tools();
        for (let turn = 0; turn < 20; turn++) {
          controller.signal.throwIfAborted();
          if (JSON.stringify(chat.messages).length > 1_000_000)
            throw new Error(
              'Helper history is full. Start a new helper chat; previous history remains saved.',
            );
          const response = await this.fetcher(p.baseUrl.replace(/\/$/, '') + '/chat/completions', {
            method: 'POST',
            headers: this.headers(p),
            redirect: 'error',
            signal: AbortSignal.any([controller.signal, AbortSignal.timeout(180000)]),
            body: JSON.stringify({
              model: chat.model,
              messages: [{ role: 'system', content: HELPER_INSTRUCTIONS }, ...chat.messages],
              tools: bridge.list.map((t) => ({
                type: 'function',
                function: { name: t.name, description: t.description, parameters: t.inputSchema },
              })),
              stream: true,
              stream_options: { include_usage: true },
            }),
          });
          if (!response.ok) throw new Error(`Proxy request failed (HTTP ${response.status})`);
          let streamed: any;
          let savedAt = 0;
          const body: any = await helperCompletion(response, (text) => {
            if (!streamed) {
              streamed = { role: 'assistant', content: text };
              chat.messages.push(streamed);
            }
            streamed.content = text;
            if (Date.now() - savedAt > 150) {
              this.save(chat);
              savedAt = Date.now();
            }
          });
          const message = body.choices?.[0]?.message;
          if (
            message?.role !== 'assistant' ||
            (typeof message.content !== 'string' && !Array.isArray(message.tool_calls))
          )
            throw new Error('Proxy returned an unsupported response');
          const savedMessage = {
            role: 'assistant',
            content: message.content ?? null,
            ...(message.tool_calls?.length ? { tool_calls: message.tool_calls } : {}),
          };
          if (streamed) Object.assign(streamed, savedMessage);
          else chat.messages.push(savedMessage);
          if (
            message.tool_calls &&
            (!Array.isArray(message.tool_calls) ||
              message.tool_calls.length > 32 ||
              message.tool_calls.some(
                (c: any) => typeof c.id !== 'string' || typeof c.function?.arguments !== 'string',
              ))
          )
            throw new Error('Proxy returned invalid tool calls');
          if (body.usage) {
            const u = body.usage;
            chat.usage = {
              input: (chat.usage?.input ?? 0) + (u.prompt_tokens ?? 0),
              output: (chat.usage?.output ?? 0) + (u.completion_tokens ?? 0),
              total: (chat.usage?.total ?? 0) + (u.total_tokens ?? 0),
            };
          }
          this.save(chat);
          if (!message.tool_calls?.length) {
            chat.status = 'idle';
            return;
          }
          for (const call of message.tool_calls) {
            controller.signal.throwIfAborted();
            let result: unknown;
            try {
              if (!bridge.list.some((t) => t.name === call.function?.name))
                throw new Error('Tool unavailable');
              const args = JSON.parse(call.function.arguments);
              result = await bridge.call(call.function.name, args);
              const serialized = JSON.stringify(result);
              if (serialized.length > 60000)
                result = {
                  truncated: true,
                  text: serialized.slice(0, 60000),
                  instruction:
                    'Result exceeded the helper view limit. Request a smaller page; inspect exact receipts before any retry.',
                };
            } catch {
              result = {
                isError: true,
                message:
                  'Tool request failed. Inspect current session state and receipts before retrying.',
              };
            }
            chat.messages.push({
              role: 'tool',
              tool_call_id: call.id,
              content: JSON.stringify(result),
            });
            this.save(chat);
          }
        }
        throw new Error('Helper reached its 20-step limit. Inspect results before continuing.');
      } catch (e) {
        chat.status = controller.signal.aborted ? 'stopped' : 'error';
        chat.error = controller.signal.aborted
          ? 'Turn stopped. Completed tool actions remain applied.'
          : (e as Error).message;
      } finally {
        this.save(chat);
        this.running.delete(chat.id);
        try {
          await bridge?.close();
        } catch {
          /* cleanup cannot replay an action */
        }
      }
    })();
    this.jobs.add(job);
    void job.finally(() => this.jobs.delete(job));
  }
}
