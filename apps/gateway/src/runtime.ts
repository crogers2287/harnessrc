import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { capabilities, type Session, type Adapter } from '@harnessrc/protocol';
import { Store } from '@harnessrc/storage';
import { HerdrClient, sessionFromAgent } from '@harnessrc/herdr';
import {
  JsonlAdapter,
  HermesAdapter,
  OpenCodeAdapter,
  CodexBridgeAdapter,
  bridgeRequest,
} from '@harnessrc/adapters';
import { TaskQueue } from '@harnessrc/task-queue';
import { InteractionBroker } from '@harnessrc/interaction-broker';
import type { Config } from './config.ts';
export class Runtime extends EventEmitter {
  clients = new Map<string, HerdrClient>();
  adapters = new Map<string, Adapter>();
  queue: TaskQueue;
  broker: InteractionBroker;
  private interval?: NodeJS.Timeout;
  private refreshing = new Set<string>();
  private tickBusy = false;
  constructor(
    public store: Store,
    public config: Config,
  ) {
    super();
    for (const s of store.sessions()) {
      s.connected = false;
      s.status = 'offline';
      store.saveSession(s);
    }
    for (const h of config.hosts) {
      const client = new HerdrClient(h.id, h.socket, h.name);
      this.clients.set(h.id, client);
      client.on('connected', () => void this.refresh(h.id));
      client.on('invalidate', () => void this.refresh(h.id));
      client.on('disconnected', () => {
        for (const s of store.sessions().filter((s) => s.hostId === h.id)) {
          s.connected = false;
          s.status = 'offline';
          store.saveSession(s);
        }
        this.emit('change');
      });
    }
    this.queue = new TaskQueue(store, (id) => this.adapters.get(id));
    this.broker = new InteractionBroker(
      store,
      (id) => this.adapters.get(id),
      (s) => this.assertBinding(s),
    );
  }
  async assertBinding(s: Session) {
    await this.clients.get(s.hostId)!.assertBinding(s);
    if (s.processIdentity) {
      const { process_info } = await this.clients
        .get(s.hostId)!
        .request('pane.process_info', { pane_id: s.paneId });
      if (processIdentity(process_info) !== s.processIdentity)
        throw new Error('Herdr process replaced');
    }
    if (!this.store.session(s.id).connected || this.store.session(s.id).generation !== s.generation)
      throw new Error('Session binding changed');
  }
  start() {
    for (const c of this.clients.values()) c.start();
    this.interval = setInterval(() => void this.tick(), 700);
  }
  async refresh(hostId: string) {
    if (this.refreshing.has(hostId)) return;
    this.refreshing.add(hostId);
    try {
      const client = this.clients.get(hostId)!;
      if (!client.host.connected) return;
      const snapshot = await client.snapshot();
      const seen = new Set<string>();
      const counts = new Map<string, number>();
      for (const a of snapshot.agents) {
        const s = sessionFromAgent(
          hostId,
          a,
          snapshot.workspaces.find((w) => w.workspace_id === a.workspace_id)?.label ?? 'Workspace',
        );
        counts.set(s.id, (counts.get(s.id) ?? 0) + 1);
      }
      for (const a of snapshot.agents) {
        const s = sessionFromAgent(
          hostId,
          a,
          snapshot.workspaces.find((w) => w.workspace_id === a.workspace_id)?.label ?? 'Workspace',
        );
        seen.add(s.id);
        const old = this.store.sessions().find((x) => x.id === s.id);
        if (old) {
          s.lastActivity = old.lastActivity;
          s.preview = old.preview;
          s.queuePaused = old.queuePaused;
        }
        let adapter: Adapter | undefined;
        try {
          const { process_info } = await client.request('pane.process_info', { pane_id: s.paneId });
          s.processIdentity = processIdentity(process_info);
          s.generation = createHash('sha256')
            .update(`${s.generation}:${s.processIdentity}`)
            .digest('hex');
        } catch {
          s.diagnostic =
            'Process identity unavailable; native turn control requires a verifiable owner.';
        }
        const bridge = this.config.bridges.find(
          (b) => b.hostId === hostId && b.nativeSessionId === s.nativeSessionId,
        );
        if (bridge) {
          adapter =
            this.adapters.get(s.id) ??
            new CodexBridgeAdapter(bridge.socket, (session) => this.assertBinding(session));
          try {
            const native = await bridgeRequest(bridge.socket, 'snapshot', {
              sessionId: s.nativeSessionId,
              includeEvents: false,
            });
            if (native.sessionId !== s.nativeSessionId)
              throw new Error('Bridge native identity mismatch');
            s.ownership = 'gateway-native';
            s.status = native.status;
            adapter.capabilities = capabilities(
              Object.entries(native.capabilities ?? {})
                .filter(([, value]) => value)
                .map(([key]) => key) as any,
            );
            s.capabilities = s.processIdentity
              ? adapter.capabilities
              : capabilities(['readConversation', 'streamConversation']);
          } catch (e) {
            s.diagnostic = (e as Error).message;
            s.connected = false;
          }
        } else if (a.agent_session) {
          adapter = this.adapters.get(s.id);
          if (!adapter) {
            if (['claude', 'codex', 'omp'].includes(s.harness))
              adapter = new JsonlAdapter(
                this.config.transcripts[s.harness as 'claude' | 'codex' | 'omp'],
                s.harness as 'claude' | 'codex' | 'omp',
              );
            if (s.harness === 'hermes') adapter = new HermesAdapter(this.config.transcripts.hermes);
            if (s.harness === 'opencode' && this.config.opencode[hostId]) {
              const oc = this.config.opencode[hostId];
              adapter = new OpenCodeAdapter(
                oc.endpoint,
                oc.authorizationEnv ? process.env[oc.authorizationEnv] : undefined,
              );
            }
          }
          s.capabilities = adapter?.capabilities ?? capabilities([]);
          s.ownership = 'herdr-cli';
          s.diagnostic =
            'Native transcript observation. CLI turn control is unavailable; installed Claude permission hooks can answer exact approvals.';
          if (
            s.harness === 'claude' &&
            this.store
              .interactions(s.id)
              .some(
                (i) =>
                  i.route === 'claude-hook' && i.status === 'pending' && i.leaseUntil > Date.now(),
              )
          ) {
            s.capabilities = { ...s.capabilities, approveAction: true, rejectAction: true };
          }
        } else s.diagnostic = 'Herdr has not reported a native session identity yet.';
        if (counts.get(s.id)! > 1) {
          s.connected = false;
          s.capabilities = capabilities(['readConversation']);
          s.diagnostic = 'Multiple live processes report this native session; control disabled.';
        }
        if (old && old.generation !== s.generation) {
          for (const i of this.store
            .interactions(s.id)
            .filter((i) => ['pending', 'answered', 'responding'].includes(i.status))) {
            i.status = 'stale';
            this.store.saveInteraction(i);
          } /* Queue generation checks prevent delivery to replacements. */
        }
        this.store.saveSession(s);
        if (adapter) this.adapters.set(s.id, adapter);
      }
      for (const s of this.store.sessions().filter((s) => s.hostId === hostId && !seen.has(s.id))) {
        s.status = 'ended';
        s.connected = false;
        this.store.saveSession(s);
      }
      this.emit('change');
    } catch (e) {
      const client = this.clients.get(hostId)!;
      client.host.diagnostic = (e as Error).message;
      for (const s of this.store.sessions().filter((s) => s.hostId === hostId)) {
        s.connected = false;
        s.status = 'offline';
        this.store.saveSession(s);
      }
    } finally {
      this.refreshing.delete(hostId);
    }
  }
  async tick() {
    if (this.tickBusy) return;
    this.tickBusy = true;
    try {
      for (const id of this.clients.keys()) await this.refresh(id);
      for (const s of this.store.sessions().filter((s) => s.connected)) {
        const adapter = this.adapters.get(s.id);
        if (!adapter) continue;
        try {
          for (const e of await adapter.read(s)) this.store.event(s, e);
          if (adapter.interactions) {
            const native = await adapter.interactions(s);
            const ids = new Set(native.map((i) => i.nativeRequestId));
            for (const i of native) {
              const pending = this.broker.open(s.id, i);
              this.broker.heartbeat(pending.id);
            }
            for (const old of this.store
              .interactions(s.id)
              .filter(
                (i) =>
                  i.route !== 'claude-hook' &&
                  i.status === 'pending' &&
                  !ids.has(i.nativeRequestId),
              )) {
              old.status = 'stale';
              this.store.saveInteraction(old);
            }
          }
          await this.queue.tick(s.id);
        } catch (e) {
          const current = this.store.session(s.id);
          const diagnostic = (e as Error).message;
          if (current.diagnostic !== diagnostic) {
            current.diagnostic = diagnostic;
            this.store.saveSession(current);
          }
        }
      }
      this.broker.expire();
    } finally {
      this.tickBusy = false;
    }
  }
  async stop() {
    clearInterval(this.interval);
    for (const c of this.clients.values()) c.stop();
    while (this.tickBusy || this.refreshing.size) await new Promise((r) => setTimeout(r, 10));
  }
}
function processIdentity(info: any): string {
  if (
    !info ||
    typeof info.shell_pid !== 'number' ||
    typeof info.foreground_process_group_id !== 'number'
  )
    throw new Error('Herdr process identity is unavailable');
  return `${info.shell_pid}:${info.foreground_process_group_id}`;
}
