#!/usr/bin/env -S npx tsx
/** One native Zcode owner for Relay's isolated session database. Never resumes another CLI's DB. */
import { spawn } from 'node:child_process';
import net from 'node:net';
import { createInterface } from 'node:readline';
import { mkdirSync, chmodSync, existsSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const directory = path.resolve(process.env.RC_ZCODE_DIR ?? '.data/zcode');
mkdirSync(directory, { recursive: true, mode: 0o700 });
chmodSync(directory, 0o700);
const socketPath = path.join(directory, 'native.sock');
if (existsSync(socketPath)) {
  const alive = await new Promise<boolean>((resolve) => {
    const s = net.createConnection(socketPath);
    s.on('connect', () => {
      s.destroy();
      resolve(true);
    });
    s.on('error', () => resolve(false));
  });
  if (alive) throw new Error('Zcode bridge already running; refusing a second writer');
  unlinkSync(socketPath);
}
const generation = randomUUID();
const pending = new Map<string, any>();
const replies = new Map<
  string,
  { resolve: (v: any) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }
>();
const db = new DatabaseSync(path.join(directory, 'receipts.sqlite'));
db.exec(
  'PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS dispatches(id TEXT PRIMARY KEY, body TEXT NOT NULL, result TEXT)',
);
const allowed = new Set([
  'session/create',
  'session/resume',
  'session/list',
  'session/read',
  'session/events',
  'session/send',
  'session/stop',
  'session/setModel',
]);
const rpc = (method: string, params: unknown) =>
  new Promise<any>((resolve, reject) => {
    const id = randomUUID();
    const timer = setTimeout(() => {
      replies.delete(id);
      reject(new Error(`Zcode ${method} confirmation timed out; do not repeat an uncertain write`));
    }, 9000);
    replies.set(id, { resolve, reject, timer });
    child.stdin!.write(JSON.stringify({ id, method, params }) + '\n');
  });
const materialized = new Set<string>();
const resuming = new Map<string, Promise<void>>();
async function subscribe(sessionId: string) {
  await rpc('session/subscribe', { sessionId, deliveryKind: 'desktop-continuous' });
  materialized.add(sessionId);
}
async function ensureSession(sessionId: string) {
  if (materialized.has(sessionId)) return;
  let resume = resuming.get(sessionId);
  if (!resume) {
    resume = (async () => {
      await rpc('session/resume', { sessionId });
      await subscribe(sessionId);
    })();
    resuming.set(sessionId, resume);
  }
  try {
    await resume;
  } finally {
    if (resuming.get(sessionId) === resume) resuming.delete(sessionId);
  }
}
async function execute(method: string, params: any) {
  if (params?.sessionId && !['session/create', 'session/resume', 'session/list'].includes(method))
    await ensureSession(params.sessionId);
  const result = await rpc(method, params);
  if (method === 'session/create' || method === 'session/resume') await subscribe(params.sessionId);
  if (method === 'session/stop')
    for (const [id, r] of pending) if (r.params.sessionId === params.sessionId) pending.delete(id);
  return result;
}
const server = net.createServer((socket) => {
  let buffer = '';
  let admitted = false;
  socket.setTimeout(12000, () => socket.destroy());
  socket.on('error', () => {});
  socket.on('data', async (chunk) => {
    if (admitted) return;
    buffer += chunk;
    if (buffer.length > 256 * 1024) {
      socket.destroy();
      return;
    }
    const nl = buffer.indexOf('\n');
    if (nl < 0) return;
    admitted = true;
    let id: unknown;
    try {
      const request = JSON.parse(buffer.slice(0, nl));
      id = request.id;
      const p = request.params ?? {};
      let result: unknown;
      if (request.method === 'bridge/info') result = { generation };
      else {
        if (p.generation !== generation)
          throw new Error('Zcode owner changed; refresh before writing');
        if (request.method === 'bridge/pending')
          result = [...pending.values()].filter((r) => r.params.sessionId === p.sessionId);
        else if (request.method === 'bridge/respond') {
          const r = pending.get(p.requestId);
          if (!r || r.params.sessionId !== p.sessionId)
            throw new Error('Zcode interaction is no longer pending');
          child.stdin!.write(JSON.stringify({ id: r.id, result: p.response }) + '\n');
          pending.delete(p.requestId);
          result = { accepted: true };
        } else if (request.method === 'bridge/call' && allowed.has(p.method)) {
          if (p.operationId) {
            const body = JSON.stringify([p.method, p.params]);
            const previous = db
              .prepare('SELECT body,result FROM dispatches WHERE id=?')
              .get(p.operationId);
            if (previous) {
              if (previous.body !== body)
                throw new Error('Zcode operation ID conflicts with an earlier request');
              if (!previous.result)
                throw new Error('Earlier Zcode delivery is uncertain; it will not be repeated');
              result = JSON.parse(String(previous.result));
            } else {
              db.prepare('INSERT INTO dispatches VALUES(?,?,NULL)').run(p.operationId, body);
              result = await execute(p.method, p.params);
              db.prepare('UPDATE dispatches SET result=? WHERE id=?').run(
                JSON.stringify(result),
                p.operationId,
              );
            }
          } else {
            result = await execute(p.method, p.params);
          }
        } else throw new Error('Unsupported Zcode bridge method');
      }
      socket.end(JSON.stringify({ id, result }) + '\n');
    } catch (error) {
      socket.end(JSON.stringify({ id, error: (error as Error).message }) + '\n');
    }
  });
});
// Bind before starting the native owner. Concurrent starts cannot spawn a second writer.
await new Promise<void>((resolve, reject) => {
  server.once('error', reject);
  server.listen(socketPath, resolve);
});
chmodSync(socketPath, 0o600);
const child = spawn(process.env.RC_ZCODE_BINARY ?? 'zcode', ['app-server'], {
  env: { ...process.env, ZCODE_SESSION_DB_PATH: path.join(directory, 'sessions.sqlite') },
  stdio: ['pipe', 'pipe', 'inherit'],
});
createInterface({ input: child.stdout! }).on('line', (line) => {
  try {
    const r = JSON.parse(line);
    if (r.id !== undefined && !r.method) {
      const reply = replies.get(String(r.id));
      if (reply) {
        clearTimeout(reply.timer);
        replies.delete(String(r.id));
        if (r.error) reply.reject(new Error(r.error.message));
        else reply.resolve(r.result);
      }
    } else if (r.id !== undefined) {
      if (r.method === 'session/requestRuntimePreferences')
        child.stdin!.write(
          JSON.stringify({
            id: r.id,
            result: {
              nativeSearchEnhancementsEnabled: false,
              askUserQuestionAutoResolutionEnabled: false,
            },
          }) + '\n',
        );
      else if (['interaction/requestPermission', 'interaction/requestUserInput'].includes(r.method))
        pending.set(r.params.requestId, r);
      else
        child.stdin!.write(
          JSON.stringify({
            id: r.id,
            error: { code: -32601, message: 'Relay does not provide this host capability' },
          }) + '\n',
        );
    } else if (
      r.method === 'session/event' &&
      ['permission.resolved', 'userInput.resolved'].includes(r.params?.type)
    )
      pending.delete(r.params.payload?.requestId);
  } catch {
    console.error('Invalid Zcode protocol frame');
  }
});
function stop(code = 0) {
  server.close();
  child?.kill('SIGTERM');
  for (const r of replies.values()) {
    clearTimeout(r.timer);
    r.reject(new Error('Zcode owner disconnected'));
  }
  replies.clear();
  process.exit(code);
}
child.on('error', () => stop(1));
child.on('exit', (code) => stop(code ?? 1));
process.on('SIGTERM', () => stop());
process.on('SIGINT', () => stop());
