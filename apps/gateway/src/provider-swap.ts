import { z } from 'zod';
import { setTimeout as sleep } from 'node:timers/promises';
import type { Runtime } from './runtime.ts';
import type { Launcher } from './launch.ts';
import { idleDescendants, resumeCodexProvider } from './codex-provider-resume.ts';
import { CodexDaemon } from '../../../packages/adapters/src/codex-daemon.ts';

export const swapInput = z
  .object({
    requestId: z.uuid(),
    generation: z.string().min(1),
    profileId: z.string().min(1),
    model: z.string().min(1).max(160),
    permission: z.string().optional(),
    confirm: z.literal(true),
  })
  .strict();
export type SwapReceipt = {
  requestId: string;
  sessionId: string;
  generation: string;
  status: 'restarting' | 'started' | 'uncertain';
  phase?: string;
  nativeArchive?: { threadId: string; descendants: string[] };
  profileId: string;
  model: string;
  paneId?: string;
  terminalId?: string;
  diagnostic?: string;
};
/** Herdr is the only lifecycle owner. A replacement never starts before the old owner exits. */
export class ProviderSwaps {
  constructor(
    private runtime: Runtime,
    private launcher: Launcher,
  ) {
    runtime.store.db
      .prepare(
        "UPDATE provider_swaps SET receipt=json_set(receipt,'$.status','uncertain','$.diagnostic','Gateway restarted during provider swap. Inspect the session before any recovery.') WHERE json_extract(receipt,'$.status')='restarting'",
      )
      .run();
  }
  receipt(id: string) {
    const row = this.runtime.store.db
      .prepare('SELECT receipt FROM provider_swaps WHERE id=?')
      .get(id);
    return row ? (JSON.parse(String(row.receipt)) as SwapReceipt) : undefined;
  }
  async catalog(id: string) {
    const s = this.runtime.store.session(id);
    const supported =
      ['claude', 'codex'].includes(s.harness) &&
      s.nativeSessionKind === 'id' &&
      z.uuid().safeParse(s.nativeSessionId).success &&
      this.runtime.config.hosts.some((h) => h.id === s.hostId && h.localFiles);
    const profiles = supported
      ? (await this.launcher.catalog({ hostId: s.hostId, harness: s.harness })).filter(
          (p) => p.hostId === s.hostId && p.harness === s.harness,
        )
      : [];
    return {
      supported: supported && profiles.length > 0,
      reason: !supported
        ? 'Exact Herdr-owned resume is currently available for local Claude Code and Codex sessions. Other harnesses can use supported live model controls.'
        : profiles.length
          ? undefined
          : 'Configure a matching provider launch profile on this host.',
      generation: s.generation,
      cwd: s.cwd,
      nativeSessionId: s.nativeSessionId,
      profiles,
    };
  }
  async restart(id: string, input: unknown, deviceId: string): Promise<SwapReceipt> {
    const value = swapInput.parse(input),
      store = this.runtime.store;
    const fingerprint = JSON.stringify({ sessionId: id, ...value });
    const prior = store.db
      .prepare('SELECT fingerprint,receipt FROM provider_swaps WHERE id=?')
      .get(value.requestId);
    if (prior) {
      if (prior.fingerprint !== fingerprint)
        throw new Error('Restart request ID was used for different settings');
      return JSON.parse(String(prior.receipt));
    }
    const s = store.session(id);
    if (s.generation !== value.generation || !s.connected)
      throw new Error('Session owner changed or disconnected; refresh before restarting');
    const catalog = await this.catalog(id);
    if (!catalog.supported || !catalog.profiles.some((p) => p.id === value.profileId))
      throw new Error(catalog.reason ?? 'Choose a provider for this harness and host');
    const profile = this.launcher.profile(value.profileId);
    const { resolved } = await this.launcher.directory(profile.id, s.cwd);
    if (resolved !== s.cwd)
      throw new Error('Session CWD is not canonical; refresh before restarting');
    if (
      !/^[a-zA-Z0-9][a-zA-Z0-9._:/@+-]*$/.test(value.model) ||
      (!profile.allowCustomModel &&
        !(await this.launcher.models(profile)).some((m) => m.id === value.model))
    )
      throw new Error('Choose an available model');
    const permissions = await this.launcher.permissionOptions(profile);
    if (permissions.length && !permissions.some((p) => p.id === value.permission))
      throw new Error('Choose permissions for the restarted session');
    if (value.permission && !permissions.some((p) => p.id === value.permission))
      throw new Error('Permission preset unavailable');
    const permission = profile.permissionPresets.find((p) => p.id === value.permission);
    const env: Record<string, string> = {};
    for (const [target, source] of Object.entries(profile.environment)) {
      const secret = process.env[source];
      if (!secret) throw new Error('Provider credentials are not configured on this host');
      env[target] = secret;
    }
    await this.runtime.assertBinding(s);
    const state = await this.runtime.adapters.get(id)?.turnState?.(s);
    if (
      !['idle', 'done'].includes(state ?? '') ||
      store
        .interactions(id)
        .some((i) => ['pending', 'responding', 'answered', 'uncertain'].includes(i.status))
    )
      throw new Error(
        'Finish or stop the current turn and resolve pending questions before swapping providers',
      );
    const daemonSocket = this.runtime.config.codexDaemons.find(
      (d) => d.hostId === s.hostId,
    )?.socket;
    if (s.harness === 'codex' && daemonSocket) {
      const native = new CodexDaemon(daemonSocket);
      try {
        const { thread } = await native.request('thread/read', {
          threadId: s.nativeSessionId,
          includeTurns: false,
        });
        if (thread.id !== s.nativeSessionId || !['idle', 'notLoaded'].includes(thread.status?.type))
          throw new Error('Native Codex is still working; finish or stop it first');
        const children = await idleDescendants(native, s.nativeSessionId);
        const observed = await this.runtime.clients.get(s.hostId)!.snapshot();
        if (
          observed.agents.some((a) => a.agent_session && children.includes(a.agent_session.value))
        )
          throw new Error(
            'A child conversation has another Herdr owner; close it before provider restart',
          );
      } finally {
        native.close();
      }
    }
    const processId = Number(s.processIdentity?.split(':')[1]);
    if (!Number.isSafeInteger(processId) || processId < 2)
      throw new Error('Exact old process identity is unavailable');
    const receipt: SwapReceipt = {
      requestId: value.requestId,
      sessionId: id,
      generation: s.generation,
      status: 'restarting',
      profileId: profile.id,
      model: value.model,
    };
    const save = () =>
      store.db
        .prepare('UPDATE provider_swaps SET receipt=? WHERE id=?')
        .run(JSON.stringify(receipt), value.requestId);
    // Re-check generation and claim atomically before the first lifecycle mutation.
    store.transaction(() => {
      if (store.session(id).generation !== value.generation)
        throw new Error('Session owner changed');
      store.db
        .prepare('INSERT INTO provider_swaps VALUES(?,?,?,?,?)')
        .run(value.requestId, id, fingerprint, JSON.stringify(receipt), new Date().toISOString());
      this.runtime.queue.pause(id, true);
      store.db
        .prepare('INSERT OR IGNORE INTO session_preferences(session_id,name) VALUES(?,?)')
        .run(id, s.sessionName || s.project);
      store.audit(deviceId, 'session.provider-swap.requested', id, {
        requestId: value.requestId,
        profileId: profile.id,
        model: value.model,
        permission: value.permission,
      });
    });
    try {
      const client = this.runtime.clients.get(s.hostId)!;
      receipt.phase = 'prepare';
      save();
      const tab = await client.request(
        'tab.create',
        {
          workspace_id: s.workspaceId,
          cwd: resolved,
          label: s.sessionName || s.project,
          focus: false,
          env,
        },
        15000,
      );
      receipt.paneId = z.string().parse(tab.root_pane?.pane_id);
      receipt.terminalId = z.string().parse(tab.root_pane?.terminal_id);
      save();
      await this.runtime.assertBinding(s);
      // Do not close an owner that started work while the replacement tab was prepared.
      const latest = await this.runtime.adapters.get(id)?.turnState?.(s);
      if (!['idle', 'done'].includes(latest ?? ''))
        throw new Error('Agent started another turn; restart was not performed');
      receipt.phase = 'close';
      save();
      await client.request('pane.close', { pane_id: s.paneId }, 15000);
      receipt.phase = 'wait-exit';
      save();
      for (let n = 0; ; n++) {
        let alive = true;
        try {
          process.kill(processId, 0);
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code === 'ESRCH') alive = false;
          else throw e;
        }
        if (!alive) break;
        if (n >= 100)
          throw new Error('Old process exit was not confirmed; replacement was not started');
        await sleep(100);
      }
      receipt.phase = 'verify-owner-exit';
      save();
      const snapshot = await client.snapshot();
      if (
        snapshot.agents.some(
          (a) => a.terminal_id === s.terminalId || a.agent_session?.value === s.nativeSessionId,
        )
      )
        throw new Error('An existing native session owner remains; replacement was not started');
      const socket = this.runtime.config.codexDaemons.find((d) => d.hostId === s.hostId)?.socket;
      receipt.phase = 'resume';
      save();
      if (s.harness === 'codex' && socket) {
        const native = new CodexDaemon(socket);
        try {
          const result = await resumeCodexProvider(
            native,
            s.nativeSessionId,
            {
              cwd: resolved,
              model: value.model,
              modelProvider: profile.codexProvider ?? 'openai',
              excludeTurns: true,
              ...(permission?.sandbox ? { sandbox: permission.sandbox } : {}),
              ...(permission?.approvalPolicy ? { approvalPolicy: permission.approvalPolicy } : {}),
            },
            (descendants) => {
              receipt.nativeArchive = { threadId: s.nativeSessionId, descendants };
              save();
            },
          );
          if (
            result.thread?.id !== s.nativeSessionId ||
            result.model !== value.model ||
            result.modelProvider !== (profile.codexProvider ?? 'openai')
          )
            throw new Error('Native provider/model resume was not confirmed');
        } finally {
          native.close();
        }
      }
      receipt.phase = 'start';
      save();
      const name = `relay-swap-${value.requestId.replaceAll('-', '').slice(0, 20)}`;
      const args = [
        ...(s.harness === 'claude'
          ? ['--resume', s.nativeSessionId]
          : ['resume', s.nativeSessionId, ...(socket ? ['--remote', `unix://${socket}`] : [])]),
        ...(s.harness === 'codex' && socket ? [] : profile.args),
        ...(s.harness === 'codex' && socket ? [] : (permission?.args ?? [])),
        ...(s.harness === 'codex' && socket ? [] : [profile.modelFlag, value.model]),
      ];
      // Exact busy rejection guarantees no CLI was started. No retry on ambiguous transport errors.
      for (let n = 0; ; n++) {
        const { pane } = await client.request('pane.get', { pane_id: receipt.paneId });
        if (pane?.terminal_id !== receipt.terminalId)
          throw new Error('Replacement pane owner changed');
        try {
          await client.request(
            'agent.start',
            { name, kind: s.harness, pane_id: receipt.paneId, args, timeout_ms: 30000 },
            35000,
          );
          break;
        } catch (e) {
          if ((e as any).code !== 'agent_pane_busy' || n >= 20) throw e;
          await sleep(500);
        }
      }
      receipt.phase = 'confirm';
      save();
      for (let n = 0; ; n++) {
        const { agent } = await client.request('agent.get', { target: receipt.paneId });
        if (agent.terminal_id !== receipt.terminalId || agent.name !== name)
          throw new Error('Replacement owner changed');
        if (
          agent.agent_session?.value === s.nativeSessionId &&
          agent.agent === s.harness &&
          agent.interactive_ready
        )
          break;
        if (n >= 100) throw new Error('Exact resumed conversation was not confirmed');
        await sleep(250);
      }
      receipt.phase = 'bind';
      save();
      for (let n = 0; n < 40; n++) {
        await this.runtime.refresh(s.hostId);
        if (store.session(id).terminalId === receipt.terminalId) break;
        await sleep(250);
      }
      const current = store.session(id);
      if (
        current.terminalId !== receipt.terminalId ||
        current.nativeSessionId !== s.nativeSessionId
      )
        throw new Error('Relay resume binding was not confirmed');
      receipt.status = 'started';
      receipt.diagnostic = 'Conversation resumed. Queued work remains paused for review.';
      save();
      store.audit(deviceId, 'session.provider-swap.completed', id, {
        requestId: value.requestId,
        profileId: profile.id,
        model: value.model,
      });
    } catch {
      receipt.status = 'uncertain';
      receipt.diagnostic =
        'Restart was not confirmed. Inspect this session and its replacement pane before another restart. Queued work remains paused.';
      save();
      store.audit(deviceId, 'session.provider-swap.uncertain', id, {
        requestId: value.requestId,
        phase: receipt.phase,
      });
    }
    return receipt;
  }
}
