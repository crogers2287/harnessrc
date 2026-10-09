import { nativeFiles } from '@harnessrc/protocol';
import { publishArtifact } from './artifacts.ts';
import { VoiceService, MAX_VOICE_BYTES, voiceMimeSchema } from './voice.ts';
import { DshAdapter } from '../../../packages/adapters/src/dsh-session.ts';
import { sendMessage } from './messages.ts';
import { randomUUID } from 'node:crypto';
import { deliverSteer } from './steering.ts';
import { Launcher, launchRequestSchema } from './launch.ts';
import Fastify, { type FastifyRequest, type FastifyReply } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import staticPlugin from '@fastify/static';
import { existsSync, mkdirSync, createReadStream, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { z, ZodError } from 'zod';
import { MAX_ATTACHMENT_BYTES } from '../../../packages/storage/src/attachments.ts';
import { Store } from '@harnessrc/storage';
import type { SessionView } from '@harnessrc/protocol';
import { Auth, type Device } from './auth.ts';
import { Runtime } from './runtime.ts';
import { startHookServer } from './hook-server.ts';
import { TailnetAuth, type TailnetNode } from './tailnet.ts';
import type { Config } from './config.ts';
declare module 'fastify' {
  interface FastifyRequest {
    device: Device;
    tailnetNode?: TailnetNode;
  }
}
export async function createGateway(
  config: Config,
  options: {
    startRuntime?: boolean;
    hook?: boolean;
    store?: Store;
    tailnetLookup?: (ip: string) => Promise<TailnetNode>;
  } = {},
) {
  mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
  const store = options.store ?? new Store(path.join(config.dataDir, 'gateway.db'));
  const runtime = new Runtime(store, config);
  const voice = new VoiceService(config.voice);
  const launcher = new Launcher(
    store,
    config.launchProfiles,
    runtime.clients,
    new Map(config.codexDaemons.map((d) => [d.hostId, d.socket])),
    runtime.dshHosts,
  );
  launcher.recover();
  const tailnet = new TailnetAuth(options.tailnetLookup);
  const auth = new Auth(store, config.dataDir);
  const app = Fastify({ logger: false, bodyLimit: 256 * 1024, trustProxy: false });
  app.addContentTypeParser(
    'application/octet-stream',
    { parseAs: 'buffer', bodyLimit: MAX_ATTACHMENT_BYTES },
    (_req, body, done) => done(null, body),
  );
  await app.register(cookie);
  await app.register(rateLimit, { max: 600, timeWindow: '1 minute' });
  await app.register(websocket, { options: { maxPayload: 65536 } });
  const setTokens = (reply: FastifyReply, tokens: { access: string; refresh: string }) => {
    reply.setCookie('rc_access', tokens.access, {
      httpOnly: true,
      secure: config.secureCookies,
      sameSite: 'strict',
      path: '/',
      maxAge: 900,
    });
    reply.setCookie('rc_refresh', tokens.refresh, {
      httpOnly: true,
      secure: config.secureCookies,
      sameSite: 'strict',
      path: '/api/auth',
      maxAge: 30 * 24 * 60 * 60,
    });
  };
  app.addHook('onRequest', async (req, reply) => {
    reply
      .header('X-Content-Type-Options', 'nosniff')
      .header('Referrer-Policy', 'no-referrer')
      .header(
        'Content-Security-Policy',
        `default-src 'self'; connect-src 'self' ws: wss: ${config.tailnet?.endpoint ?? ''}; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`,
      );
    const url = req.url.split('?')[0];
    if (!url.startsWith('/api/') && url !== '/ws') return;
    reply.header('Cache-Control', 'no-store');
    const origins = [
      config.origin,
      ...(config.tailnet ? [new URL(config.tailnet.endpoint).origin] : []),
    ];
    if (req.headers.origin && !origins.includes(req.headers.origin))
      return reply.code(403).send({ error: 'Origin not allowed' });
    if (url === '/ws' && !origins.includes(req.headers.origin ?? ''))
      return reply.code(403).send({ error: 'WebSocket origin required' });
    if (config.tailnet && req.headers.origin && origins.includes(req.headers.origin)) {
      reply
        .header('Access-Control-Allow-Origin', req.headers.origin)
        .header('Vary', 'Origin')
        .header('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS')
        .header('Access-Control-Allow-Headers', 'Content-Type, X-RC-Request')
        .header('Access-Control-Allow-Private-Network', 'true');
      if (req.method === 'OPTIONS') return reply.code(204).send();
    }
    if (url === '/api/connection') return;
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers['x-rc-request'] !== '1')
      return reply.code(403).send({ error: 'CSRF request header required' });
    if (['/api/auth/pair', '/api/auth/refresh'].includes(url)) return;
    try {
      req.tailnetNode = config.tailnet ? await tailnet.identify(req.raw) : undefined;
      req.device = req.tailnetNode
        ? auth.tailnetDevice(req.tailnetNode)
        : auth.authenticate(req.cookies.rc_access);
    } catch {
      return reply.code(401).send({ error: 'Authentication required or expired' });
    }
  });
  app.setErrorHandler((error, req, reply) => {
    const status = error instanceof ZodError ? 400 : ((error as any).statusCode ?? 409);
    store.audit(req.device?.id ?? 'anonymous', 'request.failed', null, {
      route: req.routeOptions.url,
      error: (error as Error).message,
    });
    reply
      .code(status >= 400 ? status : 500)
      .send({ error: error instanceof ZodError ? 'Invalid request' : (error as Error).message });
  });
  const check = (req: FastifyRequest, id: string, control = false) => {
    store.session(id);
    if (!auth.allowed(req.device, id, control))
      throw Object.assign(new Error('Session permission denied'), { statusCode: 403 });
  };
  app.get('/api/voice', async () => ({ enabled: voice.enabled, maxSeconds: 180 }));
  app.post(
    '/api/sessions/:id/dictation',
    {
      bodyLimit: MAX_VOICE_BYTES,
      config: { rateLimit: { max: 6, timeWindow: '1 minute' } },
    },
    async (req) => {
      const { id } = z.object({ id: z.string() }).parse(req.params);
      check(req, id, true);
      const { mime } = z.object({ mime: voiceMimeSchema }).parse(req.query);
      if (!Buffer.isBuffer(req.body))
        throw Object.assign(new Error('Send a binary audio recording'), { statusCode: 400 });
      const result = await voice.transcribe(req.body, mime);
      // Only operation metadata is audited; audio and transcript are never persisted here.
      store.audit(req.device.id, 'voice.transcribe', id, {
        bytes: req.body.length,
        cleaned: result.cleaned,
      });
      return result;
    },
  );
  const sessionViews = (device: Device): SessionView[] =>
    store
      .sessions()
      .filter((s) => auth.allowed(device, s.id))
      .map((s) => ({
        ...s,
        ...(() => {
          const preference = store.db
            .prepare('SELECT name,pinned,archived FROM session_preferences WHERE session_id=?')
            .get(s.id);
          return {
            relayName: preference?.name as string | undefined,
            pinned: !!preference?.pinned,
            archived: !!preference?.archived,
            canManage: auth.allowed(device, s.id, true),
          };
        })(),
        capabilities: auth.allowed(device, s.id, true)
          ? s.capabilities
          : Object.fromEntries(
              Object.entries(s.capabilities).map(([k, v]) => [
                k,
                k.startsWith('read') || k === 'streamConversation' ? v : false,
              ]),
            ),
        pendingCount: store.interactions(s.id).filter((i) => i.status === 'pending').length,
        queuedCount: store.tasks(s.id).filter((t) => t.status === 'pending').length,
      }));
  app.get('/api/connection', async () => ({ tailnetEndpoint: config.tailnet?.endpoint ?? null }));
  app.get('/health', async () => ({ ok: true }));
  // APKs are operator-published artifacts, never arbitrary client-supplied paths.
  const androidApk = path.join(config.dataDir, 'android', 'relay.apk');
  app.get('/api/android', async () => {
    if (!existsSync(androidApk)) return { available: false };
    const manifest = z
      .object({ version: z.string(), sha256: z.string().regex(/^[a-f0-9]{64}$/) })
      .parse(
        JSON.parse(readFileSync(path.join(config.dataDir, 'android', 'release.json'), 'utf8')),
      );
    return {
      available: true,
      ...manifest,
      size: statSync(androidApk).size,
      url: `${config.tailnet?.endpoint ?? config.origin}/api/android/apk`,
    };
  });
  app.get('/api/android/apk', async (_req, reply) => {
    if (!existsSync(androidApk))
      return reply.code(404).send({ error: 'Android package not published' });
    return reply
      .type('application/vnd.android.package-archive')
      .header('Content-Disposition', 'attachment; filename="Relay.apk"')
      .header('Content-Length', statSync(androidApk).size)
      .send(createReadStream(androidApk));
  });
  app.post(
    '/api/auth/pair',
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const { key, name } = z
        .object({ key: z.string().min(32).max(256), name: z.string().trim().min(1).max(80) })
        .parse(req.body);
      try {
        setTokens(reply, auth.pair(key, name));
        return { ok: true };
      } catch {
        throw Object.assign(new Error('Invalid pairing key'), { statusCode: 401 });
      }
    },
  );
  app.post('/api/auth/refresh', async (req, reply) => {
    try {
      setTokens(reply, auth.refresh(req.cookies.rc_refresh));
      return { ok: true };
    } catch {
      throw Object.assign(new Error('Device authentication expired'), { statusCode: 401 });
    }
  });
  app.get('/api/auth/me', async (req) => ({ device: req.device }));
  app.post('/api/auth/logout', async (req, reply) => {
    const { hash } = await import('./auth.ts');
    for (const token of [req.cookies.rc_access, req.cookies.rc_refresh])
      if (token) store.db.prepare('DELETE FROM tokens WHERE hash=?').run(hash(token));
    reply.clearCookie('rc_access', { path: '/' }).clearCookie('rc_refresh', { path: '/api/auth' });
    return { ok: true };
  });
  const launchAdmin = (req: FastifyRequest) => {
    if (!req.device.admin)
      throw Object.assign(new Error('Administrator required to create sessions'), {
        statusCode: 403,
      });
  };
  app.get('/api/launch/profiles', async (req) => {
    launchAdmin(req);
    return { profiles: await launcher.catalog() };
  });
  app.get('/api/launch/folders', async (req) => {
    launchAdmin(req);
    const { profileId, path: folder } = z
      .object({ profileId: z.string(), path: z.string().optional() })
      .parse(req.query);
    return launcher.folders(profileId, folder);
  });
  app.get('/api/launch/:id', async (req) => {
    launchAdmin(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const receipt = launcher.receipt(id);
    if (!receipt) throw Object.assign(new Error('Launch not found'), { statusCode: 404 });
    return receipt;
  });
  app.post(
    '/api/launch',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req) => {
      launchAdmin(req);
      const receipt = await launcher.launch(launchRequestSchema.parse(req.body), req.device.id);
      if (runtime.dshHosts.has(receipt.hostId))
        void runtime.dshHosts.get(receipt.hostId)!.refresh();
      else void runtime.refresh(receipt.hostId);
      return receipt;
    },
  );
  app.get('/api/sessions', async (req) => ({ sessions: sessionViews(req.device) }));
  app.get('/api/hosts', async (req) => ({
    hosts: [
      ...runtime.clients.values(),
      ...[...runtime.dshHosts.values()].map((h) => ({
        host: {
          id: h.config.id,
          name: h.config.name,
          connected: h.connected,
          diagnostic: h.diagnostic,
        },
      })),
    ].map((c) =>
      req.device.admin ? c.host : { id: c.host.id, name: c.host.name, connected: c.host.connected },
    ),
  }));
  app.patch('/api/sessions/:id/preferences', async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    check(req, id, true);
    const patch = z
      .object({
        name: z.string().trim().min(1).max(120).nullable().optional(),
        pinned: z.boolean().optional(),
        archived: z.boolean().optional(),
      })
      .strict()
      .parse(req.body);
    store.transaction(() => {
      store.db.prepare('INSERT OR IGNORE INTO session_preferences(session_id) VALUES(?)').run(id);
      if (patch.name !== undefined)
        store.db
          .prepare('UPDATE session_preferences SET name=? WHERE session_id=?')
          .run(patch.name, id);
      if (patch.pinned !== undefined)
        store.db
          .prepare('UPDATE session_preferences SET pinned=? WHERE session_id=?')
          .run(Number(patch.pinned), id);
      if (patch.archived !== undefined)
        store.db
          .prepare('UPDATE session_preferences SET archived=? WHERE session_id=?')
          .run(Number(patch.archived), id);
      store.audit(req.device.id, 'session.preferences', id, patch);
    });
    store.emit('change', id);
    return { session: sessionViews(req.device).find((s) => s.id === id) };
  });
  app.get('/api/sessions/:id', async (req) => {
    const { id } = req.params as { id: string };
    check(req, id);
    return {
      session: sessionViews(req.device).find((s) => s.id === id),
      interactions: store.interactions(id),
      tasks: store.tasks(id),
    };
  });
  app.get('/api/sessions/:id/events', async (req) => {
    const { id } = req.params as { id: string };
    check(req, id);
    await runtime.prepareConversation(id);
    const query = z
      .object({
        after: z.coerce.number().int().min(0).default(0),
        before: z.coerce.number().int().min(1).optional(),
        conversation: z.enum(['1']).optional(),
        limit: z.coerce.number().int().min(1).max(200).default(100),
      })
      .parse(req.query);
    return {
      events: query.conversation
        ? store.conversationEvents(id, query.before ?? Number.MAX_SAFE_INTEGER, query.limit)
        : store.events(id, query.after, query.limit, query.before),
    };
  });
  app.post(
    '/api/sessions/:id/artifacts',
    {
      bodyLimit: MAX_ATTACHMENT_BYTES,
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (req) => {
      const { id } = req.params as { id: string };
      check(req, id, true);
      if (!Buffer.isBuffer(req.body)) throw new Error('Expected binary artifact content');
      return publishArtifact(
        store,
        runtime.attachments,
        store.session(id),
        req.device.id,
        req.query,
        req.body,
      );
    },
  );
  app.get('/api/sessions/:id/attachments', async (req) => {
    const { id } = req.params as { id: string };
    check(req, id);
    return { attachments: runtime.attachments.list(store.session(id)) };
  });
  app.post(
    '/api/sessions/:id/attachments',
    { bodyLimit: MAX_ATTACHMENT_BYTES, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req) => {
      const { id } = req.params as { id: string };
      check(req, id, true);
      const session = store.session(id);
      if (!session.capabilities.attachFiles)
        throw new Error('File delivery is not connected for this session');
      const { name, mime } = z
        .object({
          name: z.string().min(1).max(200),
          mime: z
            .string()
            .max(100)
            .regex(/^[\w.+-]+\/[\w.+-]+$/)
            .default('application/octet-stream'),
        })
        .parse(req.query);
      if (!Buffer.isBuffer(req.body)) throw new Error('Expected binary file content');
      const attachment = runtime.attachments.add(session, name, mime, req.body);
      store.audit(req.device.id, 'attachment.upload', id, {
        attachmentId: attachment.id,
        size: attachment.size,
      });
      return { attachment };
    },
  );
  app.get('/api/sessions/:id/attachments/:file', async (req, reply) => {
    const { id, file } = req.params as { id: string; file: string };
    check(req, id);
    const { row, bytes } = runtime.attachments.read(store.session(id), file);
    // Downloads never execute uploaded HTML/SVG in the gateway origin.
    return reply
      .type('application/octet-stream')
      .header(
        'Content-Disposition',
        `attachment; filename*=UTF-8''${encodeURIComponent(String(row.name))}`,
      )
      .send(bytes);
  });
  app.delete('/api/sessions/:id/attachments/:file', async (req) => {
    const { id, file } = req.params as { id: string; file: string };
    check(req, id, true);
    runtime.attachments.remove(store.session(id), file);
    store.audit(req.device.id, 'attachment.remove', id, { attachmentId: file });
    return { ok: true };
  });
  const permissionChanges = new Set<string>();
  app.get('/api/sessions/:id/permissions', async (req) => {
    const { id } = req.params as { id: string };
    check(req, id);
    const adapter = runtime.adapters.get(id);
    if (!(adapter instanceof DshAdapter))
      return {
        supported: false,
        options: [],
        reason:
          'This session’s native connection does not expose permission changes yet. Existing harness permissions remain in effect.',
      };
    await runtime.assertBinding(store.session(id));
    return adapter.permissions(store.session(id));
  });
  app.post('/api/sessions/:id/permissions', async (req) => {
    const { id } = req.params as { id: string };
    check(req, id, true);
    const body = z
      .object({ value: z.string().min(1).max(100), expected: z.string(), confirm: z.literal(true) })
      .strict()
      .parse(req.body);
    const adapter = runtime.adapters.get(id);
    if (!(adapter instanceof DshAdapter))
      throw Object.assign(new Error('Native permission changes unavailable'), { statusCode: 409 });
    if (permissionChanges.has(id))
      throw Object.assign(new Error('A permission change is already in progress'), {
        statusCode: 409,
      });
    permissionChanges.add(id);
    try {
      await runtime.assertBinding(store.session(id));
      store.audit(req.device.id, 'permissions.requested', id, { value: body.value });
      const result = await adapter.setPermissions(store.session(id), body.value, body.expected);
      store.audit(req.device.id, 'permissions.applied', id, { value: result.current });
      return result;
    } finally {
      permissionChanges.delete(id);
    }
  });
  app.get('/api/sessions/:id/models', async (req) => {
    const { id } = req.params as { id: string };
    check(req, id);
    const adapter = runtime.adapters.get(id);
    if (!(adapter instanceof DshAdapter)) throw new Error('Native model selection unavailable');
    await runtime.assertBinding(store.session(id));
    const catalog = (await adapter.native.models()) as Record<string, unknown>;
    const row = await adapter.row(store.session(id));
    return { ...catalog, current: row.projections?.values.modelSelection?.next };
  });
  app.post('/api/sessions/:id/model', async (req) => {
    const { id } = req.params as { id: string };
    check(req, id, true);
    const value = z
      .object({
        provider: z.string().min(1).max(160),
        model: z.string().min(1).max(160),
        reasoningEffort: z.string().max(80).optional(),
      })
      .strict()
      .parse(req.body);
    const adapter = runtime.adapters.get(id);
    if (!(adapter instanceof DshAdapter)) throw new Error('Native model selection unavailable');
    await runtime.assertBinding(store.session(id));
    const result = await adapter.native.selectModel(
      store.session(id).nativeSessionId,
      value.provider,
      value.model,
      value.reasoningEffort,
    );
    store.audit(req.device.id, 'session.model', id, value);
    return result;
  });
  app.get('/api/sessions/:id/message-receipts/:requestId', async (req) => {
    const { id, requestId } = req.params as { id: string; requestId: string };
    check(req, id);
    z.uuid().parse(requestId);
    const receipt = store.db
      .prepare('SELECT result FROM message_receipts WHERE request_id=? AND session_id=?')
      .get(requestId, id);
    if (!receipt) return { nativeSeen: false };
    const result = JSON.parse(String(receipt.result ?? '{}'));
    const nativeId = result.task?.id ?? requestId;
    const echo = store.db
      .prepare(
        `SELECT 1 FROM events WHERE session_id=?
      AND json_extract(body,'$.kind')='user.message'
      AND (json_extract(body,'$.data.taskId')=? OR json_extract(body,'$.data.requestId')=?) LIMIT 1`,
      )
      .get(id, nativeId, nativeId);
    return { nativeSeen: !!echo };
  });
  app.post('/api/sessions/:id/messages', async (req) => {
    const { id } = req.params as { id: string };
    check(req, id, true);
    return sendMessage(runtime, id, req.device.id, req.body);
  });
  app.post('/api/sessions/:id/tasks', async (req) => {
    const { id } = req.params as { id: string };
    check(req, id, true);
    const task = runtime.queue.add(id, req.body);
    store.audit(req.device.id, 'task.queue', id, { taskId: task.id });
    return { task };
  });
  app.patch('/api/sessions/:id/tasks/:task', async (req) => {
    const { id, task } = req.params as { id: string; task: string };
    check(req, id, true);
    const { prompt } = z.object({ prompt: z.string() }).parse(req.body);
    const updated = runtime.queue.edit(id, task, prompt);
    store.audit(req.device.id, 'task.edit', id, { taskId: task });
    return { task: updated };
  });
  app.delete('/api/sessions/:id/tasks/:task', async (req) => {
    const { id, task } = req.params as { id: string; task: string };
    check(req, id, true);
    const updated = runtime.queue.cancel(id, task);
    store.audit(req.device.id, 'task.cancel', id, { taskId: task });
    return { task: updated };
  });
  app.post('/api/sessions/:id/queue', async (req) => {
    const { id } = req.params as { id: string };
    check(req, id, true);
    const body = z
      .object({ paused: z.boolean().optional(), order: z.array(z.string()).optional() })
      .parse(req.body);
    if (body.paused !== undefined) runtime.queue.pause(id, body.paused);
    if (body.order) runtime.queue.reorder(id, body.order);
    store.audit(req.device.id, 'queue.update', id, body);
    return { ok: true };
  });
  app.get('/api/sessions/:id/media/:eventId/:index', async (req, reply) => {
    const { id, eventId, index } = z
      .object({ id: z.string(), eventId: z.uuid(), index: z.coerce.number().int().min(0).max(31) })
      .parse(req.params);
    check(req, id, false);
    const session = store.session(id);
    const row = store.db
      .prepare('SELECT body FROM events WHERE id=? AND session_id=?')
      .get(eventId, id);
    const event = row ? JSON.parse(String(row.body)) : undefined;
    const file = event && nativeFiles(event)[index];
    const host = runtime.dshHosts.get(session.hostId);
    if (!file || !host || event.nativeSessionId !== session.nativeSessionId)
      return reply.code(404).send({ error: 'Conversation file not found' });
    const result = await host.native.file(file.path);
    const image = /^(image\/(png|jpeg|webp|gif|avif))(;|$)/i.test(result.mime);
    reply.header('Cache-Control', 'private, no-store');
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Content-Security-Policy', "sandbox; default-src 'none'");
    reply.header(
      'Content-Disposition',
      `${image ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(file.path.split('/').pop() || 'file')}`,
    );
    return reply.type(image ? result.mime : 'application/octet-stream').send(result.bytes);
  });
  app.post('/api/interactions/:id/respond', async (req) => {
    const { id } = req.params as { id: string };
    const i = store.interaction(id);
    check(req, i.sessionId, true);
    const { response } = z.object({ response: z.unknown() }).parse(req.body);
    return { interaction: await runtime.broker.respond(id, response, req.device.id) };
  });
  app.post('/api/sessions/:id/steer', async (req) => {
    const { id } = req.params as { id: string };
    check(req, id, true);
    const s = store.session(id);
    const { prompt, idempotencyKey } = z
      .object({ prompt: z.string().trim().min(1).max(32000), idempotencyKey: z.uuid().optional() })
      .parse(req.body);
    if (!s.capabilities.steerActiveTurn || !runtime.adapters.get(id)?.steer)
      throw new Error('Native steering unavailable');
    return deliverSteer(
      store,
      idempotencyKey ?? randomUUID(),
      req.device.id,
      id,
      prompt,
      async () => {
        await runtime.assertBinding(s);
        await runtime.adapters.get(id)!.steer!(s, prompt);
        store.audit(req.device.id, 'turn.steer', id, {});
      },
    );
  });
  app.post('/api/sessions/:id/interrupt', async (req) => {
    const { id } = req.params as { id: string };
    check(req, id, true);
    const s = store.session(id);
    z.object({ confirm: z.literal(true) }).parse(req.body);
    if (!s.capabilities.interruptTurn || !runtime.adapters.get(id)?.interrupt)
      throw new Error('Native interruption unavailable');
    await runtime.assertBinding(s);
    await runtime.adapters.get(id)!.interrupt!(s);
    store.audit(req.device.id, 'turn.interrupt', id, {});
    return { ok: true };
  });
  app.get('/api/devices', async (req) => {
    if (!req.device.admin) return { devices: [req.device] };
    return {
      devices: store.db.prepare('SELECT id,name,admin,revoked,created_at FROM devices').all(),
      grants: store.db.prepare('SELECT * FROM grants').all(),
    };
  });
  app.post('/api/devices/pairing', async (req) => ({
    key: auth.pairCode(req.device),
    expiresIn: 300,
  }));
  app.delete('/api/devices/:id', async (req) => {
    auth.revoke(req.device, (req.params as { id: string }).id);
    return { ok: true };
  });
  app.put('/api/devices/:id/grants/:session', async (req) => {
    const { id, session } = req.params as { id: string; session: string };
    const { control } = z.object({ control: z.boolean() }).parse(req.body);
    auth.grant(req.device, id, session, control);
    return { ok: true };
  });
  app.get('/api/audit', async (req) => {
    if (!req.device.admin)
      throw Object.assign(new Error('Administrator required'), { statusCode: 403 });
    return {
      entries: store.db.prepare('SELECT * FROM audit ORDER BY sequence DESC LIMIT 100').all(),
    };
  });
  app.get('/ws', { websocket: true }, (socket, req) => {
    const token = req.cookies.rc_access;
    let timer: NodeJS.Timeout | undefined;
    const push = () => {
      try {
        const device = req.tailnetNode
          ? auth.tailnetDevice(req.tailnetNode)
          : auth.authenticate(token);
        if (socket.readyState === 1)
          socket.send(JSON.stringify({ type: 'invalidate', sessions: sessionViews(device) }));
      } catch {
        socket.close(4001, 'Authentication expired');
      }
    };
    const changed = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = undefined;
        push();
      }, 100);
    };
    const authCheck = setInterval(push, 10000);
    const event = (value: { sessionId: string }) => {
      try {
        const device = req.tailnetNode
          ? auth.tailnetDevice(req.tailnetNode)
          : auth.authenticate(token);
        if (!auth.allowed(device, value.sessionId)) return;
        if (socket.bufferedAmount > 4 * 1024 * 1024) {
          socket.close(1013, 'Reconnect for durable replay');
          return;
        }
        if (socket.readyState === 1) socket.send(JSON.stringify({ type: 'event', event: value }));
      } catch {
        socket.close(4001, 'Authentication expired');
      }
    };
    store.on('event', event);
    store.on('change', changed);
    socket.on('message', () => socket.close(1008, 'Client commands use authenticated HTTP'));
    socket.on('close', () => {
      clearInterval(authCheck);
      clearTimeout(timer);
      store.off('change', changed);
      store.off('event', event);
    });
    push();
  });
  const dist = path.resolve('apps/web/dist');
  if (existsSync(dist)) {
    await app.register(staticPlugin, { root: dist });
    app.setNotFoundHandler((req, reply) =>
      req.url.startsWith('/api/')
        ? reply.code(404).send({ error: 'Not found' })
        : reply.sendFile('index.html'),
    );
  }
  const hookServer =
    options.hook === false
      ? undefined
      : await startHookServer(runtime, path.join(config.dataDir, 'hooks.sock'));
  app.addHook('onClose', async () => {
    await runtime.stop();
    if (hookServer) await new Promise<void>((resolve) => hookServer.close(() => resolve()));
    store.close();
  });
  if (options.startRuntime !== false) runtime.start();
  return { app, runtime, store, auth };
}
