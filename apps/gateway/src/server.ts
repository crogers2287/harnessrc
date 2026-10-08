import Fastify, { type FastifyRequest, type FastifyReply } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import staticPlugin from '@fastify/static';
import { existsSync, mkdirSync } from 'node:fs';
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
  const sessionViews = (device: Device): SessionView[] =>
    store
      .sessions()
      .filter((s) => auth.allowed(device, s.id))
      .map((s) => ({
        ...s,
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
  app.get('/api/sessions', async (req) => ({ sessions: sessionViews(req.device) }));
  app.get('/api/hosts', async (req) => ({
    hosts: [...runtime.clients.values()].map((c) =>
      req.device.admin ? c.host : { id: c.host.id, name: c.host.name, connected: c.host.connected },
    ),
  }));
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
    const query = z
      .object({
        after: z.coerce.number().int().min(0).default(0),
        before: z.coerce.number().int().min(1).optional(),
        limit: z.coerce.number().int().min(1).max(200).default(100),
      })
      .parse(req.query);
    return { events: store.events(id, query.after, query.limit, query.before) };
  });
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
    const { prompt } = z.object({ prompt: z.string().trim().min(1).max(32000) }).parse(req.body);
    if (!s.capabilities.steerActiveTurn || !runtime.adapters.get(id)?.steer)
      throw new Error('Native steering unavailable');
    await runtime.assertBinding(s);
    await runtime.adapters.get(id)!.steer!(s, prompt);
    store.audit(req.device.id, 'turn.steer', id, {});
    return { ok: true };
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
