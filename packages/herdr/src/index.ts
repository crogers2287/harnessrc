import net from 'node:net';
import { randomUUID, createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { z } from 'zod';
import { capabilities, type Host, type Session } from '@harnessrc/protocol';
export const agentSchema = z.object({
  terminal_id: z.string(),
  pane_id: z.string(),
  workspace_id: z.string(),
  agent: z.string().nullable().optional(),
  display_agent: z.string().nullable().optional(),
  agent_status: z.enum(['idle', 'working', 'blocked', 'done', 'unknown']),
  agent_session: z
    .object({
      agent: z.string(),
      kind: z.enum(['id', 'path']),
      value: z.string(),
      source: z.string(),
    })
    .nullable()
    .optional(),
  cwd: z.string().nullable().optional(),
  foreground_cwd: z.string().nullable().optional(),
  interactive_ready: z.boolean().optional(),
  name: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  terminal_title_stripped: z.string().nullable().optional(),
  tab_id: z.string().optional(),
  revision: z.number().optional(),
});
export type Agent = z.infer<typeof agentSchema>;
export class HerdrError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export class HerdrClient extends EventEmitter {
  host: Host;
  subscription?: net.Socket;
  stopped = false;
  private retry?: NodeJS.Timeout;
  constructor(
    public hostId: string,
    public path: string,
    name = hostId,
  ) {
    super();
    this.host = { id: hostId, name, socket: path, connected: false };
  }
  async request(method: string, params: unknown = {}, timeout = 5000): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = randomUUID();
      const socket = net.createConnection(this.path);
      let buf = '';
      let settled = false;
      const finish = (error?: Error, result?: unknown) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        if (error) reject(error);
        else resolve(result);
      };
      socket.setTimeout(timeout, () =>
        finish(new HerdrError('timeout', 'Herdr request timed out')),
      );
      socket.on('connect', () => socket.write(JSON.stringify({ id, method, params }) + '\n'));
      socket.on('error', (e) => finish(e));
      socket.on('close', () =>
        finish(new HerdrError('disconnected', 'Herdr connection closed before confirmation')),
      );
      socket.on('data', (chunk) => {
        buf += chunk;
        if (Buffer.byteLength(buf) > 16 * 1024 * 1024)
          return finish(new Error('Herdr response exceeds limit'));
        let nl;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          try {
            const r = JSON.parse(line);
            if (r.id !== id) continue;
            if (r.error) finish(new HerdrError(r.error.code, r.error.message));
            else finish(undefined, r.result);
          } catch (e) {
            finish(e as Error);
          }
        }
      });
    });
  }
  start() {
    this.stopped = false;
    this.subscribe();
  }
  private subscribe() {
    if (this.stopped) return;
    const socket = net.createConnection(this.path);
    this.subscription = socket;
    let buf = '';
    let acknowledged = false;
    socket.on('connect', () =>
      socket.write(
        JSON.stringify({
          id: 'subscribe',
          method: 'events.subscribe',
          params: {
            subscriptions: [
              'workspace.created',
              'workspace.updated',
              'workspace.closed',
              'pane.created',
              'pane.closed',
              'pane.updated',
              'pane.exited',
              'pane.agent_detected',
              'pane.moved',
            ].map((type) => ({ type })),
          },
        }) + '\n',
      ),
    );
    socket.on('data', (chunk) => {
      buf += chunk;
      if (Buffer.byteLength(buf) > 8 * 1024 * 1024) {
        socket.destroy();
        return;
      }
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        try {
          const r = JSON.parse(line);
          if (r.error) {
            this.host.diagnostic = r.error.code;
            socket.destroy();
            break;
          }
          if (!acknowledged) {
            acknowledged = true;
            this.host.connected = true;
            this.host.diagnostic = undefined;
            this.emit('connected');
          } else this.emit('invalidate');
        } catch {
          socket.destroy();
        }
      }
    });
    socket.on('error', (e) => {
      this.host.diagnostic = e.message;
    });
    socket.on('close', () => {
      if (this.stopped) return;
      this.host.connected = false;
      this.emit('disconnected');
      if (!this.stopped) this.retry = setTimeout(() => this.subscribe(), 2000);
    });
  }
  async snapshot(): Promise<{ agents: Agent[]; workspaces: any[]; tabs: any[]; panes: any[] }> {
    const r = await this.request('session.snapshot');
    const snapshot = z
      .object({
        version: z.string(),
        protocol: z.number(),
        agents: z.array(agentSchema),
        tabs: z.array(z.object({ tab_id: z.string(), label: z.string() })).default([]),
        panes: z.array(z.object({ pane_id: z.string(), label: z.string().optional() })).default([]),
        workspaces: z.array(z.object({ workspace_id: z.string(), label: z.string() })),
      })
      .parse(r.snapshot);
    this.host.version = snapshot.version;
    this.host.protocol = snapshot.protocol;
    return snapshot;
  }
  async assertBinding(session: Session) {
    const { agent } = await this.request('agent.get', { target: session.paneId });
    const a = agentSchema.parse(agent);
    if (
      a.terminal_id !== session.terminalId ||
      a.agent_session?.value !== session.nativeSessionId ||
      a.agent_session?.kind !== session.nativeSessionKind
    )
      throw new HerdrError('session_replaced', 'Session owner changed');
    return a;
  }
  stop() {
    this.stopped = true;
    clearTimeout(this.retry);
    this.subscription?.destroy();
  }
}
export function sessionFromAgent(hostId: string, agent: Agent, project: string): Session {
  const harness = (
    agent.agent ??
    agent.agent_session?.agent ??
    agent.display_agent ??
    'unknown'
  ).toLowerCase();
  const native = agent.agent_session?.value ?? `unbound:${agent.terminal_id}`;
  const id = createHash('sha256')
    .update(JSON.stringify([hostId, harness, native]))
    .digest('hex')
    .slice(0, 32);
  return {
    id,
    hostId,
    harness,
    nativeSessionId: native,
    nativeSessionKind: agent.agent_session?.kind ?? 'id',
    terminalId: agent.terminal_id,
    paneId: agent.pane_id,
    workspaceId: agent.workspace_id,
    project,
    sessionName: agent.name ?? agent.title ?? agent.terminal_title_stripped ?? undefined,
    cwd: agent.foreground_cwd ?? agent.cwd ?? '',
    status: agent.agent_status,
    ownership: 'observed',
    capabilities: capabilities([]),
    generation: createHash('sha256')
      .update(JSON.stringify([agent.terminal_id, native]))
      .digest('hex'),
    lastActivity: new Date().toISOString(),
    preview: '',
    connected: true,
    queuePaused: false,
  };
}
