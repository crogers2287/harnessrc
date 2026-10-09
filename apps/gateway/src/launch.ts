import type { DshHost } from './dsh-host.ts';
import { CodexDaemon } from '../../../packages/adapters/src/codex-daemon.ts';
import { realpath, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { Store } from '@harnessrc/storage';
import { HerdrError, type HerdrClient } from '@harnessrc/herdr';

// Profiles are trusted host configuration. Clients choose IDs, never commands or environment.
export const launchProfileSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  hostId: z.string(),
  label: z.string(),
  harness: z.enum(['claude', 'codex', 'pi', 'omp', 'opencode', 'hermes', 'dsh']),
  provider: z.string().default('Harness default'),
  modelsEndpoint: z.string().url().optional(),
  defaultModel: z
    .string()
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/@+-]*$/)
    .optional(),
  codexProvider: z.string().optional(),
  dshProvider: z.string().default('cfrproxy'),
  dshPreset: z.string().optional(),
  workspaceId: z.string(),
  roots: z.array(z.string()).min(1),
  args: z.array(z.string()).default([]),
  modelFlag: z.string().default('--model'),
  models: z.array(z.object({ id: z.string(), name: z.string() })).default([]),
  allowCustomModel: z.boolean().default(false),
  // Map child environment names to gateway environment names; values never leave Fred.
  environment: z.record(z.string(), z.string()).default({}),
});
export type LaunchProfile = z.infer<typeof launchProfileSchema>;
export const launchRequestSchema = z
  .object({
    requestId: z.string().uuid(),
    profileId: z.string(),
    cwd: z.string().min(1).max(4096),
    name: z.string().trim().min(1).max(80),
    model: z.string().max(160).default(''),
    prompt: z.string().trim().min(1).max(32000),
  })
  .strict();
export type LaunchRequest = z.infer<typeof launchRequestSchema>;
export type LaunchReceipt = {
  requestId: string;
  status: 'starting' | 'started' | 'uncertain';
  hostId: string;
  paneId?: string;
  terminalId?: string;
  nativeSessionId?: string;
  diagnostic?: string;
};
const within = (root: string, candidate: string) =>
  candidate === root || candidate.startsWith(root + path.sep);

export class Launcher {
  constructor(
    private store: Store,
    private profiles: LaunchProfile[],
    private clients: Map<string, HerdrClient>,
    private codexSockets = new Map<string, string>(),
    private dshHosts = new Map<string, DshHost>(),
  ) {}
  profile(id: string) {
    const p = this.profiles.find((p) => p.id === id);
    if (!p) throw new Error('Launch profile unavailable');
    return p;
  }
  async directory(id: string, candidate?: string) {
    const profile = this.profile(id);
    const roots = await Promise.all(profile.roots.map((root) => realpath(root)));
    const resolved = await realpath(candidate ?? roots[0]);
    if (!roots.some((root) => within(root, resolved)))
      throw new Error('Folder is outside permitted project roots');
    if (!(await stat(resolved)).isDirectory()) throw new Error('Choose a directory');
    return { resolved, roots };
  }
  async folders(id: string, candidate?: string) {
    const { resolved, roots } = await this.directory(id, candidate);
    const entries = await readdir(resolved, { withFileTypes: true });
    const directories = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .sort((a, b) => a.name.localeCompare(b.name));
    return {
      path: resolved,
      roots,
      parent: roots.some((root) => within(root, path.dirname(resolved)))
        ? path.dirname(resolved)
        : null,
      directories: directories
        .slice(0, 500)
        .map((e) => ({ name: e.name, path: path.join(resolved, e.name) })),
      truncated: directories.length > 500,
    };
  }
  async catalog() {
    return Promise.all(
      this.profiles.map(async (p) => ({
        id: p.id,
        hostId: p.hostId,
        label: p.label,
        harness: p.harness,
        provider: p.provider,
        models: await this.models(p),
        allowCustomModel: p.allowCustomModel,
        defaultModel: p.defaultModel,
        connected:
          this.dshHosts.get(p.hostId)?.connected ??
          this.clients.get(p.hostId)?.host.connected ??
          false,
      })),
    );
  }
  private modelCache = new Map<string, { at: number; models: { id: string; name: string }[] }>();
  async models(p: LaunchProfile) {
    if (p.harness === 'dsh') {
      const host = this.dshHosts.get(p.hostId);
      if (!host?.connected) return [];
      const catalog = z
        .object({
          groups: z.array(
            z.object({
              id: z.string(),
              models: z.array(z.object({ id: z.string(), name: z.string() })),
            }),
          ),
        })
        .parse(await host.native.models());
      return catalog.groups.find((g) => g.id === p.dshProvider)?.models ?? [];
    }
    if (!p.modelsEndpoint) return p.models;
    const cached = this.modelCache.get(p.id);
    if (cached && Date.now() - cached.at < 60000) return cached.models;
    try {
      const response = await fetch(p.modelsEndpoint, {
        signal: AbortSignal.timeout(3000),
        redirect: 'error',
      });
      if (!response.ok) return p.models;
      const body = z
        .object({ data: z.array(z.object({ id: z.string().max(160) })).max(2000) })
        .parse(await response.json());
      const models = body.data
        .filter((m) => /^[a-zA-Z0-9][a-zA-Z0-9._:/@+-]*$/.test(m.id))
        .map((m) => ({ id: m.id, name: m.id }));
      this.modelCache.set(p.id, { at: Date.now(), models });
      return models;
    } catch {
      return p.models;
    }
  }
  receipt(requestId: string): LaunchReceipt | undefined {
    const row = this.store.db.prepare('SELECT receipt FROM launches WHERE id=?').get(requestId);
    return row ? JSON.parse(row.receipt as string) : undefined;
  }
  async launch(input: LaunchRequest, deviceId: string): Promise<LaunchReceipt> {
    const fingerprint = JSON.stringify(input);
    const existing = this.store.db
      .prepare('SELECT body,receipt FROM launches WHERE id=?')
      .get(input.requestId);
    if (existing) {
      if (existing.body !== fingerprint)
        throw new Error('This launch request ID was already used for different settings');
      return JSON.parse(existing.receipt as string);
    }
    const p = this.profile(input.profileId);
    const client = this.clients.get(p.hostId);
    const dsh = this.dshHosts.get(p.hostId);
    if (!(p.harness === 'dsh' ? dsh?.connected : client?.host.connected))
      throw new Error('Host is disconnected');
    const { resolved } = await this.directory(p.id, input.cwd);
    if (
      input.model &&
      (!/^[a-zA-Z0-9][a-zA-Z0-9._:/@+-]*$/.test(input.model) ||
        (!p.allowCustomModel && !(await this.models(p)).some((m) => m.id === input.model)))
    )
      throw new Error('Choose a supported model');
    const env: Record<string, string> = {};
    for (const [target, source] of Object.entries(p.environment)) {
      const value = process.env[source];
      if (!value) throw new Error('Provider credentials are not configured on this host');
      env[target] = value;
    }
    const receipt: LaunchReceipt = {
      requestId: input.requestId,
      hostId: p.hostId,
      status: 'starting',
    };
    // Claim before either mutation. A lost reply is never automatically retried.
    const claimed = this.store.db
      .prepare('INSERT OR IGNORE INTO launches(id,body,receipt,created_at) VALUES(?,?,?,?)')
      .run(input.requestId, fingerprint, JSON.stringify(receipt), new Date().toISOString());
    if (!claimed.changes) return this.receipt(input.requestId)!;
    const save = () =>
      this.store.db
        .prepare('UPDATE launches SET receipt=? WHERE id=?')
        .run(JSON.stringify(receipt), input.requestId);
    this.store.audit(deviceId, 'session.launch', null, {
      requestId: input.requestId,
      profileId: p.id,
      cwd: resolved,
      model: input.model,
    });
    try {
      const selectedModel = input.model || p.defaultModel;
      if (p.harness === 'dsh') {
        if (!dsh) throw new Error('DSH host unavailable');
        const nativeId = `session-${input.requestId}`;
        await dsh.native.call('session/create', {
          request: {
            sessionId: nativeId,
            cwd: resolved,
            ...(p.dshPreset ? { agentPreset: p.dshPreset } : {}),
          },
        });
        receipt.nativeSessionId = nativeId;
        receipt.terminalId = `dsh:${nativeId}`;
        save();
        if (selectedModel) await dsh.native.selectModel(nativeId, p.dshProvider, selectedModel);
        await dsh.native.call('session/rename', {
          request: { sessionId: nativeId, title: input.name },
        });
        await dsh.native.prompt(nativeId, input.requestId, input.prompt, 'queue');
        receipt.status = 'started';
        save();
        return receipt;
      }
      if (!client) throw new Error('Herdr host unavailable');
      const socket = this.codexSockets.get(p.hostId);
      if (p.harness === 'codex' && socket) {
        // Allocate a NEW native thread only. Its first and only interactive CLI is
        // subsequently launched by Herdr; never resume or replace an existing owner.
        const native = new CodexDaemon(socket);
        try {
          const { thread } = await native.request('thread/start', {
            cwd: resolved,
            model: selectedModel,
            modelProvider: p.codexProvider,
            ephemeral: false,
          });
          receipt.nativeSessionId = z.string().uuid().parse(thread.id);
          save();
          await native.request('thread/name/set', {
            threadId: receipt.nativeSessionId,
            name: input.name,
          });
        } finally {
          native.close();
        }
      }
      const tab = await client.request(
        'tab.create',
        { workspace_id: p.workspaceId, cwd: resolved, label: input.name, focus: false, env },
        15000,
      );
      receipt.paneId = z.string().parse(tab.root_pane?.pane_id);
      receipt.terminalId = z.string().parse(tab.root_pane?.terminal_id);
      save();
      // New tabs can still be initializing their shell. Herdr's explicit busy rejection
      // guarantees no input was sent; only this definite rejection is safe to retry.
      for (let attempt = 0; ; attempt++) {
        try {
          await client.request(
            'agent.start',
            {
              name: `relay-${input.requestId.replaceAll('-', '').slice(0, 24)}`,
              kind: p.harness,
              pane_id: receipt.paneId,
              args: [
                ...(receipt.nativeSessionId
                  ? ['resume', receipt.nativeSessionId, '--remote', `unix://${socket}`]
                  : []),
                ...p.args,
                ...(selectedModel ? [p.modelFlag, selectedModel] : []),
              ],
              timeout_ms: 30000,
            },
            35000,
          );
          break;
        } catch (error) {
          if (!(error instanceof HerdrError) || error.code !== 'agent_pane_busy' || attempt >= 20)
            throw error;
          await new Promise((resolve) => setTimeout(resolve, 500));
          const { pane } = await client.request('pane.get', { pane_id: receipt.paneId });
          if (pane?.terminal_id !== receipt.terminalId) throw new Error('Launch pane changed');
        }
      }
      const target = `relay-${input.requestId.replaceAll('-', '').slice(0, 24)}`;
      // The socket start result acknowledges process launch; CLI readiness is a later event.
      for (let attempt = 0; ; attempt++) {
        const { agent } = await client.request('agent.get', { target: receipt.paneId });
        if (
          agent.terminal_id !== receipt.terminalId ||
          agent.name !== target ||
          (agent.agent && agent.agent !== p.harness)
        )
          throw new Error('New session owner changed');
        if (agent.agent === p.harness && agent.interactive_ready) {
          if (receipt.nativeSessionId && agent.agent_session?.value !== receipt.nativeSessionId) {
            if (attempt >= 100) throw new Error('Native launch identity not confirmed');
          } else break;
        }
        if (attempt >= 100) throw new Error('Agent did not become ready');
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      await client.request('agent.prompt', { target, text: input.prompt }, 15000);
      receipt.status = 'started';
    } catch {
      // Native errors can contain command environments. Return a fixed, non-secret diagnostic.
      receipt.status = 'uncertain';
      receipt.diagnostic =
        'Startup was not confirmed. Check the session list before starting another session.';
    }
    save();
    return receipt;
  }
  recover() {
    for (const row of this.store.db.prepare('SELECT id,receipt FROM launches').all()) {
      const receipt: LaunchReceipt = JSON.parse(row.receipt as string);
      if (receipt.status !== 'starting') continue;
      receipt.status = 'uncertain';
      receipt.diagnostic =
        'Gateway restarted during launch. Check the session list before starting another session.';
      this.store.db
        .prepare('UPDATE launches SET receipt=? WHERE id=?')
        .run(JSON.stringify(receipt), row.id);
    }
  }
}
