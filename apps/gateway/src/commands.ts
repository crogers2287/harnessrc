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
    .regex(/^\/[a-zA-Z][\w:-]*(?: [^\x00-\x1f\x7f]*)?$/),
});
const screens: Record<string, string> = {
  help: 'help',
  model: 'details',
  permissions: 'details',
  permission: 'details',
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
    const [name, ...args] = value.line.slice(1).split(' ');
    if (!args.length && screens[name])
      return { mode: 'command', action: screens[name], message: 'Opened session controls.' };
    const adapter = runtime.adapters.get(id);
    const state = await adapter?.turnState?.(s);
    const cancel = ['stop', 'cancel', 'esc', 'ctrl-c'].includes(name);
    if (cancel && args.length) throw new Error('Control shortcuts do not accept arguments.');
    if (cancel && (!s.capabilities.interruptTurn || !adapter?.interrupt))
      throw new Error('This session does not support native interruption.');
    if (
      !cancel &&
      (state === 'blocked' ||
        runtime.store
          .interactions(id)
          .some((i) => ['pending', 'responding', 'answered', 'uncertain'].includes(i.status)))
    )
      throw new Error('Answer or dismiss the pending question before running a command.');
    if (!cancel && !['idle', 'done'].includes(state ?? ''))
      throw new Error('Stop the current turn before running a native slash command.');
    const plan = name === 'plan' && !args.length ? await adapter?.mode?.(s) : undefined;
    const host = runtime.dshHosts.get(s.hostId);
    const client = runtime.clients.get(s.hostId);
    const socket = runtime.config.codexDaemons.find((d) => d.hostId === s.hostId)?.socket;
    if (!cancel && !host && !client) throw new Error('Native command transport unavailable.');
    if (
      !cancel &&
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
    runtime.store.db
      .prepare('INSERT INTO command_receipts VALUES(?,?,?,?,?,NULL)')
      .run(value.requestId, id, deviceId, hash, s.generation);
    let message = 'Command submitted to the native harness.';
    if (cancel) {
      if (
        name === 'esc' &&
        client &&
        s.ownership === 'herdr-cli' &&
        !runtime.store
          .interactions(id)
          .some((i) => ['pending', 'responding', 'answered', 'uncertain'].includes(i.status))
      ) {
        await client.request('agent.send_keys', { target: s.paneId, keys: ['esc'] });
        message = 'Escape sent to the native harness.';
      } else {
        if (['working', 'blocked'].includes(state ?? '')) await adapter!.interrupt!(s);
        message = ['working', 'blocked'].includes(state ?? '')
          ? 'Current turn cancelled.'
          : 'No active turn.';
      }
    } else if (
      plan?.supported &&
      adapter?.setMode &&
      plan.options.some((o) => o.value === 'plan')
    ) {
      if (plan.current !== 'plan') await adapter.setMode(s, 'plan', plan.current!);
      message = 'Plan mode enabled.';
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
    const result = { mode: 'command', message };
    runtime.store.db
      .prepare('UPDATE command_receipts SET result=? WHERE id=?')
      .run(JSON.stringify(result), value.requestId);
    runtime.store.audit(deviceId, 'session.command', id, { name, requestId: value.requestId });
    return result;
  }
}
