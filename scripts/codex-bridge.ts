#!/usr/bin/env -S npx tsx
/** Sole-writer native transport, launched INSIDE Herdr. Never used to attach to an existing CLI thread. */
import { spawn, execFileSync } from 'node:child_process';
import net from 'node:net';
import { createInterface } from 'node:readline';
import { mkdirSync, chmodSync, existsSync, unlinkSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { HerdrClient } from '@harnessrc/herdr';
import { normalizeCodexNotification, codexRequestInteraction } from '@harnessrc/adapters';
import { redact, capabilities, type SourceEvent, type InteractionInput } from '@harnessrc/protocol';
import { validateResponse } from '@harnessrc/interaction-broker';
import { z } from 'zod';
const directory = path.resolve(process.env.RC_BRIDGE_DIR ?? '.data/codex-bridge');
mkdirSync(directory, { recursive: true, mode: 0o700 });
const protocolDir = process.env.RC_CODEX_SCHEMA_DIR ?? path.join(directory, 'protocol');
if (!process.env.RC_CODEX_SCHEMA_DIR)
  execFileSync(
    process.env.RC_CODEX_BINARY ?? 'codex',
    ['app-server', 'generate-json-schema', '--out', protocolDir],
    { stdio: 'pipe' },
  );
function methods(file: string): Set<string> {
  const found = new Set<string>();
  function visit(value: any) {
    if (!value || typeof value !== 'object') return;
    for (const method of value.properties?.method?.enum ?? []) found.add(method);
    for (const child of Object.values(value)) if (typeof child === 'object') visit(child);
  }
  visit(JSON.parse(readFileSync(path.join(protocolDir, file), 'utf8')));
  return found;
}
const clientMethods = methods('ClientRequest.json'),
  serverMethods = methods('ServerRequest.json');
for (const required of ['initialize', 'thread/start', 'thread/resume', 'turn/start'])
  if (!clientMethods.has(required))
    throw new Error(`Installed Codex lacks required method ${required}`);
const nativeCaps = capabilities([
  'readConversation',
  'streamConversation',
  'sendMessage',
  'queueTask',
  ...(clientMethods.has('turn/steer') ? ['steerActiveTurn' as const] : []),
  ...(clientMethods.has('turn/interrupt') ? ['interruptTurn' as const] : []),
  ...(serverMethods.has('item/tool/requestUserInput') ? ['answerQuestion' as const] : []),
  ...(serverMethods.has('item/commandExecution/requestApproval') ||
  serverMethods.has('item/fileChange/requestApproval')
    ? ['approveAction' as const, 'rejectAction' as const]
    : []),
]);
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
  if (alive) throw new Error('Native bridge already running; refusing a second writer');
  unlinkSync(socketPath);
}
const db = new DatabaseSync(path.join(directory, 'bridge.db'));
db.exec(
  'PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS state(id INTEGER PRIMARY KEY,body TEXT NOT NULL);',
);
const prior = db.prepare('SELECT body FROM state WHERE id=1').get();
type Execution = {
  status: 'dispatching' | 'running' | 'completed' | 'failed' | 'uncertain';
  correlation: string;
};
const state: {
  sessionId: string;
  status: string;
  activeTurn?: string;
  events: SourceEvent[];
  tasks: Record<string, Execution>;
  sequence: number;
} = prior
  ? JSON.parse(prior.body as string)
  : { sessionId: '', status: 'idle', events: [], tasks: {}, sequence: 0 };
for (const task of Object.values(state.tasks))
  if (['dispatching', 'running'].includes(task.status)) task.status = 'uncertain';
state.activeTurn = undefined;
state.status = 'idle';
const pending = new Map<string, { request: any; interaction: InteractionInput }>();
const save = () =>
  db
    .prepare('INSERT INTO state VALUES(1,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body')
    .run(JSON.stringify(state));
const child = spawn(
  process.env.RC_CODEX_BINARY ?? 'codex',
  ['app-server', '--listen', 'stdio://'],
  { stdio: ['pipe', 'pipe', 'inherit'] },
);
const replies = new Map<
  string,
  { resolve: (v: any) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }
>();
let server: net.Server | undefined = undefined;
let currentTask: string | undefined;
let reportSeq = 0;
const herdr = process.env.HERDR_SOCKET_PATH
  ? new HerdrClient('local', process.env.HERDR_SOCKET_PATH)
  : undefined;
const paneId = process.env.HERDR_PANE_ID;
async function report() {
  if (!herdr || !paneId) return;
  try {
    await herdr.request('pane.report_agent_session', {
      pane_id: paneId,
      source: 'herdr:codex',
      agent: 'codex',
      agent_session_id: state.sessionId,
    });
    await herdr.request('pane.report_agent', {
      pane_id: paneId,
      source: 'herdr:codex',
      agent: 'codex',
      agent_session_id: state.sessionId,
      state: state.status === 'idle' ? 'idle' : state.status === 'blocked' ? 'blocked' : 'working',
      seq: ++reportSeq,
    });
  } catch {
    console.error('Herdr registration unavailable; run npm run diagnose on this host.');
  }
}
const rpc = (method: string, params: unknown) =>
  new Promise<any>((resolve, reject) => {
    const id = randomUUID();
    const timer = setTimeout(() => {
      replies.delete(id);
      reject(new Error(`Native ${method} confirmation timed out`));
    }, 15000);
    replies.set(id, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
  });
createInterface({ input: child.stdout }).on('line', (line) => {
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
      return;
    }
    if (r.id !== undefined && r.method) {
      const interaction = codexRequestInteraction(r);
      if (!interaction) {
        /* Fail closed for unsupported native requests. Never guess a response. */ console.error(
          `Unsupported native request ${r.method}; no approval was sent.`,
        );
        state.status = 'blocked';
        save();
        return;
      }
      if (r.params?.threadId !== state.sessionId) throw new Error('Native request thread mismatch');
      pending.set(String(r.id), { request: r, interaction });
      state.status = 'blocked';
      save();
      void report();
      return;
    }
    if (r.method === 'serverRequest/resolved') {
      pending.delete(String(r.params.requestId));
      if (!pending.size) state.status = state.activeTurn ? 'working' : 'idle';
    }
    if (r.method === 'turn/started') {
      state.activeTurn = r.params.turn.id;
      state.status = 'working';
      if (currentTask) state.tasks[currentTask].correlation = state.activeTurn!;
    }
    if (r.method === 'turn/completed') {
      const turn = r.params.turn;
      for (const task of Object.values(state.tasks))
        if (task.correlation === turn.id)
          task.status = turn.status === 'completed' ? 'completed' : 'failed';
      state.activeTurn = undefined;
      state.status = 'idle';
      for (const [id, p] of pending) if (p.interaction.turnId === turn.id) pending.delete(id);
    }
    if (r.method && r.params?.threadId === state.sessionId) {
      const events = normalizeCodexNotification(r.method, r.params, ++state.sequence);
      for (const e of events)
        state.events.push({ ...e, data: redact(e.data) as Record<string, unknown> });
      save();
      void report();
    }
  } catch (e) {
    console.error((e as Error).message);
  }
});
child.on('exit', () => {
  for (const r of replies.values()) {
    clearTimeout(r.timer);
    r.reject(new Error('Native app-server exited'));
  }
  state.status = 'ended';
  save();
  server?.close();
  process.exitCode = 1;
});
await rpc('initialize', {
  clientInfo: { name: 'relay_herdr_bridge', title: 'Relay Herdr bridge', version: '0.1.0' },
  capabilities: { experimentalApi: true },
});
child.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n');
if (state.sessionId) await rpc('thread/resume', { threadId: state.sessionId });
else {
  const result = await rpc('thread/start', {
    cwd: process.cwd(),
    approvalPolicy: 'on-request',
    sandbox: 'workspace-write',
  });
  state.sessionId = result.thread.id;
}
save();
await report();
const requestSchema = z.object({
  id: z.string(),
  method: z.enum(['snapshot', 'send', 'task', 'respond', 'steer', 'interrupt']),
  params: z.record(z.string(), z.unknown()),
});
let sending = false;
server = net.createServer((socket) => {
  let buffer = '';
  socket.setTimeout(10000, () => socket.destroy());
  socket.on('data', async (chunk) => {
    buffer += chunk;
    if (buffer.length > 256 * 1024) return socket.destroy();
    const nl = buffer.indexOf('\n');
    if (nl < 0) return;
    socket.pause();
    try {
      const request = requestSchema.parse(JSON.parse(buffer.slice(0, nl)));
      const p = request.params;
      if (p.sessionId !== state.sessionId) throw new Error('Native session mismatch');
      let result: any;
      if (request.method === 'snapshot')
        result = {
          sessionId: state.sessionId,
          status: state.status,
          events:
            p.includeEvents === false
              ? []
              : state.events.slice(
                  Number(p.eventOffset ?? 0),
                  Number(p.eventOffset ?? 0) + Math.min(1000, Number(p.limit ?? 1000)),
                ),
          nextOffset:
            p.includeEvents === false
              ? Number(p.eventOffset ?? 0)
              : Math.min(
                  state.events.length,
                  Number(p.eventOffset ?? 0) + Math.min(1000, Number(p.limit ?? 1000)),
                ),
          capabilities: nativeCaps,
          interactions: [...pending.values()].map((p) => p.interaction),
        };
      if (request.method === 'task')
        result = state.tasks[String(p.taskId)] ?? { status: 'uncertain' };
      if (request.method === 'send') {
        const taskId = z.string().uuid().parse(p.taskId);
        const prompt = z.string().min(1).max(32000).parse(p.prompt);
        const known = state.tasks[taskId];
        if (known) result = { correlation: known.correlation };
        else {
          if (sending || state.activeTurn || pending.size || state.status !== 'idle')
            throw new Error('Native thread not eligible for a new turn');
          sending = true;
          state.tasks[taskId] = { status: 'dispatching', correlation: '' };
          currentTask = taskId;
          save();
          try {
            const native = await rpc('turn/start', {
              threadId: state.sessionId,
              clientUserMessageId: taskId,
              input: [{ type: 'text', text: prompt, text_elements: [] }],
            });
            state.tasks[taskId].correlation = native.turn.id;
            if (state.tasks[taskId].status === 'dispatching')
              state.tasks[taskId].status = 'running';
            state.activeTurn = native.turn.status === 'completed' ? undefined : native.turn.id;
            state.status = state.activeTurn ? 'working' : 'idle';
            save();
            result = { correlation: native.turn.id };
          } catch (e) {
            state.tasks[taskId].status = 'uncertain';
            save();
            throw e;
          } finally {
            currentTask = undefined;
            sending = false;
          }
        }
      }
      if (request.method === 'respond') {
        const requestId = z.string().parse(p.nativeRequestId);
        const request = pending.get(requestId);
        if (!request) throw new Error('Native request resolved or stale');
        validateResponse(request.interaction.responseSchema, p.response);
        const response =
          request.request.method === 'item/tool/requestUserInput'
            ? p.response
            : { decision: p.response };
        child.stdin.write(JSON.stringify({ id: request.request.id, result: response }) + '\n');
        pending.delete(requestId);
        state.status = pending.size ? 'blocked' : state.activeTurn ? 'working' : 'idle';
        save();
        result = { ok: true }; /* Never retry an answered request. */
      }
      if (request.method === 'steer') {
        if (!nativeCaps.steerActiveTurn) throw new Error('Native steering unsupported');
        if (!state.activeTurn || pending.size) throw new Error('No eligible active turn');
        result = await rpc('turn/steer', {
          threadId: state.sessionId,
          expectedTurnId: state.activeTurn,
          input: [
            { type: 'text', text: z.string().min(1).max(32000).parse(p.prompt), text_elements: [] },
          ],
        });
      }
      if (request.method === 'interrupt') {
        if (!nativeCaps.interruptTurn) throw new Error('Native interrupt unsupported');
        if (!state.activeTurn) throw new Error('No active turn');
        result = await rpc('turn/interrupt', {
          threadId: state.sessionId,
          turnId: state.activeTurn,
        });
      }
      socket.end(JSON.stringify({ id: request.id, result }) + '\n');
      void report();
    } catch (e) {
      socket.end(JSON.stringify({ error: (e as Error).message }) + '\n');
    }
  });
  socket.on('error', () => {});
});
await new Promise<void>((resolve) =>
  server!.listen(socketPath, () => {
    chmodSync(socketPath, 0o600);
    resolve();
  }),
);
console.log(
  `Relay native Codex session ${state.sessionId}\nBridge: ${socketPath}\nConfigure this exact native session and bridge socket in the gateway. Herdr owns this process.`,
);
const reporter = setInterval(() => void report(), 5000);
for (const signal of ['SIGTERM', 'SIGINT'] as const)
  process.on(signal, () => {
    clearInterval(reporter);
    server?.close();
    child.kill(signal);
  });
