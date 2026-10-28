import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Runtime } from './runtime.ts';
import { CodexDaemon } from '../../../packages/adapters/src/codex-daemon.ts';

export const commandInput = z.object({
  requestId: z.uuid(),
  generation: z.string(),
  line: z
    .string()
    .trim()
    .max(4096)
    // eslint-disable-next-line no-control-regex -- reject terminal control characters
    .regex(/^\/[a-zA-Z][\w:-]*(?:[ \n\t][^\x00-\x08\x0b\x0c\x0e-\x1f\x7f]*)?$/),
});
const screens: Record<string, string> = {
  help: 'help',
  model: 'details',
  permissions: 'details',
  permission: 'details',
  approvals: 'details',
  status: 'details',
  tasks: 'tasks',
  agents: 'subagents',
};
/** Commands never enter the model's chat or the follow-up queue. */
export class SessionCommands {
  constructor(private runtime: Runtime) {
    runtime.store.db.exec(`CREATE TABLE IF NOT EXISTS command_receipts (
      id TEXT PRIMARY KEY, session_id TEXT NOT NULL, device_id TEXT NOT NULL,
      hash TEXT NOT NULL, generation TEXT NOT NULL, result TEXT)`);
  }
  catalog(id: string) {
    const s = this.runtime.store.session(id);
    const adapter = this.runtime.adapters.get(id);
    const names = ['help', 'model', 'permissions', 'status', 'tasks', 'agents'];
    if (s.harness === 'codex' && adapter?.goal) names.splice(3, 0, 'goal');
    if (adapter?.mode || s.ownership === 'herdr-cli' || s.harness === 'dsh')
      names.push('plan', 'compact');
    if (s.capabilities.interruptTurn || s.capabilities.sendEscape) names.push('stop', 'esc');
    return names.map((name) => ({ name }));
  }
  async run(id: string, deviceId: string, input: unknown) {
    const value = commandInput.parse(input);
    const { runtime } = this;
    const s = runtime.store.session(id);
    if (s.generation !== value.generation)
      throw new Error('Session owner changed. Refresh before sending a command.');
    if (!s.capabilities.sendMessage && !s.capabilities.steerActiveTurn)
      throw new Error('This conversation is read-only.');
    await runtime.assertBinding(s);
    const hash = createHash('sha256').update(JSON.stringify(value)).digest('hex');
    const prior = runtime.store.db
      .prepare('SELECT * FROM command_receipts WHERE id=?')
      .get(value.requestId);
    if (prior) {
      if (prior.session_id !== id || prior.device_id !== deviceId || prior.hash !== hash)
        throw new Error('Command request identity conflicts with an earlier request.');
      if (prior.result) return JSON.parse(String(prior.result));
      throw new Error('Command delivery is uncertain. It will not be automatically repeated.');
    }
    const [, name, argument = ''] = /^\/([\w:-]+)(?:\s+([\s\S]*))?$/.exec(value.line)!;
    const args = argument.trim() ? argument.trim().split(/\s+/) : [];
    const adapter = runtime.adapters.get(id);
    const nativeGoal =
      s.harness === 'codex' && adapter?.goal && adapter?.setGoal && name === 'goal';
    if (nativeGoal && (!args.length || ['status', 'edit'].includes(argument)))
      return {
        mode: 'command',
        action: 'tasks',
        message:
          argument === 'edit'
            ? 'Use /goal followed by the revised objective to update your goal.'
            : 'Opened current goal.',
      };
    if (/[\n\r\t]/.test(value.line) && !nativeGoal)
      throw new Error('This native slash command must be a single line.');
    if (!args.length && screens[name])
      return { mode: 'command', action: screens[name], message: 'Opened session controls.' };
    const client = runtime.clients.get(s.hostId);
    const terminalEscape = name === 'esc' && client && s.ownership === 'herdr-cli';
    const state = terminalEscape ? undefined : await adapter?.turnState?.(s);
    const cancel = ['stop', 'cancel', 'esc', 'ctrl-c'].includes(name);
    if (cancel && args.length) throw new Error('Control shortcuts do not accept arguments.');
    if (
      cancel &&
      !(terminalEscape && s.capabilities.sendEscape) &&
      (!s.capabilities.interruptTurn || !adapter?.interrupt)
    )
      throw new Error('This session does not support native interruption.');
    if (
      !cancel &&
      !(nativeGoal && argument === 'pause') &&
      (state === 'blocked' ||
        runtime.store
          .interactions(id)
          .some((i) => ['pending', 'responding', 'answered', 'uncertain'].includes(i.status)))
    )
      throw new Error('Answer or dismiss the pending question before running a command.');
    const plan =
      name === 'plan' && (!args.length || ['on', 'off', 'default', 'plan'].includes(argument))
        ? await adapter?.mode?.(s)
        : undefined;
    const setting =
      ['model', 'permissions', 'permission', 'approvals'].includes(name) && args.length;
    const nativeSetting =
      setting &&
      (name === 'model'
        ? !!adapter?.models && !!adapter?.setModel
        : !!adapter?.permissions && !!adapter?.setPermissions);
    const nativePlan = !!(plan?.supported && adapter?.setMode);
    if (
      !cancel &&
      !nativeGoal &&
      !nativeSetting &&
      !nativePlan &&
      !['idle', 'done'].includes(state ?? '')
    )
      throw new Error('Stop the current turn before running a native slash command.');
    if (nativePlan && args.length && !['on', 'off', 'default', 'plan'].includes(argument))
      throw new Error('Use /plan, /plan on or /plan off.');
    const host = s.harness === 'dsh' ? runtime.dshHosts.get(s.hostId) : undefined;
    const socket = runtime.config.codexDaemons.find((d) => d.hostId === s.hostId)?.socket;
    if (!cancel && !nativeGoal && !nativeSetting && !nativePlan && !host && !client)
      throw new Error('Native command transport unavailable.');
    if (
      !cancel &&
      !nativeGoal &&
      !nativeSetting &&
      !nativePlan &&
      !host &&
      !(s.harness === 'codex' && name === 'compact' && socket) &&
      s.ownership !== 'herdr-cli'
    )
      throw new Error('This session has no verified interactive CLI for native slash commands.');
    if (
      !cancel &&
      runtime.store.db
        .prepare(
          'SELECT id FROM command_receipts WHERE session_id=? AND generation=? AND result IS NULL LIMIT 1',
        )
        .get(id, s.generation)
    )
      throw new Error(
        'An earlier command is still unconfirmed. Inspect the native session before another command.',
      );
    const goalChange = !nativeGoal
      ? undefined
      : argument === 'clear'
        ? { clear: true }
        : argument === 'pause'
          ? { status: 'paused' as const }
          : argument === 'resume'
            ? { status: 'active' as const }
            : { objective: argument };
    if (nativeGoal) {
      const current = await adapter!.goal!(s);
      if (!current.supported) throw new Error(current.reason || 'Native goals are unavailable.');
      if (!goalChange?.objective && !current.goal)
        throw new Error('No goal is set. Use /goal followed by an objective.');
    }
    let settingWrite: (() => Promise<unknown>) | undefined;
    if (nativeSetting && name === 'model') {
      const catalog = await adapter!.models!(s);
      const matches = catalog.groups.flatMap((g) =>
        g.models
          .filter((m) => m.id === argument || `${g.id}/${m.id}` === argument)
          .map((m) => ({ provider: g.id, model: m.id })),
      );
      if (matches.length !== 1)
        throw new Error('Choose a model from this session’s model settings.');
      settingWrite = () => adapter!.setModel!(s, matches[0]);
    } else if (nativeSetting) {
      const settings = await adapter!.permissions!(s);
      const option = settings.options.find(
        (o) => o.value === argument || o.name.toLowerCase() === argument.toLowerCase(),
      );
      if (!option || !settings.current)
        throw new Error('Choose a permission mode from this session’s settings.');
      settingWrite = () => adapter!.setPermissions!(s, option.value, settings.current!);
    }
    const planTarget = ['off', 'default'].includes(argument) ? 'default' : 'plan';
    if (nativePlan && (!plan!.current || !plan!.options.some((o) => o.value === planTarget)))
      throw new Error('This native session does not offer the requested mode.');
    runtime.store.db
      .prepare('INSERT INTO command_receipts VALUES(?,?,?,?,?,NULL)')
      .run(value.requestId, id, deviceId, hash, s.generation);
    let message = 'Command submitted to the native harness.';
    if (nativeGoal) {
      await adapter!.setGoal!(s, goalChange!);
      message =
        argument === 'clear'
          ? 'Goal cleared.'
          : argument === 'pause'
            ? 'Goal paused.'
            : argument === 'resume'
              ? 'Goal resumed.'
              : 'Goal saved to the native session.';
    } else if (settingWrite) {
      await settingWrite();
      message = name === 'model' ? 'Native model changed.' : 'Native permission mode changed.';
    } else if (cancel) {
      if (terminalEscape) {
        await client.request('agent.send_keys', { target: s.paneId, keys: ['esc'] });
        message = 'Escape sent to the native harness.';
      } else {
        if (['working', 'blocked'].includes(state ?? '')) await adapter!.interrupt!(s);
        message = ['working', 'blocked'].includes(state ?? '')
          ? 'Current turn cancelled.'
          : 'No active turn.';
      }
    } else if (nativePlan) {
      if (plan!.current !== planTarget) await adapter!.setMode!(s, planTarget, plan!.current!);
      message = planTarget === 'plan' ? 'Plan mode enabled.' : 'Plan mode disabled.';
    } else if (host) {
      const result = z
        .object({ result: z.object({ kind: z.string(), text: z.string().optional() }) })
        .parse(
          await host.native.call('commands/execute', {
            agentId: s.nativeSessionId,
            line: value.line,
            submittedAttachments: [],
          }),
        );
      if (result.result.kind !== 'success')
        throw new Error(result.result.text || 'The native command was not accepted.');
      message = result.result.text || 'Native command completed.';
    } else if (s.harness === 'codex' && name === 'compact' && socket) {
      const native = new CodexDaemon(socket);
      try {
        await native.request('thread/compact/start', { threadId: s.nativeSessionId });
      } finally {
        native.close();
      }
      message = 'Native context compaction started.';
    } else {
      const result = await client!.request('agent.prompt', {
        target: s.paneId,
        text: value.line,
      });
      if (
        result.agent?.terminal_id !== s.terminalId ||
        result.agent?.agent_session?.value !== s.nativeSessionId
      )
        throw new Error('Native command acknowledgement belongs to a different owner.');
    }
    await runtime.assertBinding(s);
    const result = { mode: 'command', message, ...(nativeGoal ? { action: 'tasks' } : {}) };
    runtime.store.db
      .prepare('UPDATE command_receipts SET result=? WHERE id=?')
      .run(JSON.stringify(result), value.requestId);
    runtime.store.audit(deviceId, 'session.command', id, { name, requestId: value.requestId });
    return result;
  }
}
