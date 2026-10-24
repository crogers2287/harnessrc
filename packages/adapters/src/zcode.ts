import { stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { zcodeUsage } from './usage.ts';
import { z } from 'zod';
import { bridgeRequest } from './codex.ts';
import { dshAnswerSchema, dshQuestionSchema } from './dsh-questions.ts';
import {
  capabilities,
  DeliveryDeferred,
  type Adapter,
  type Session,
  type Task,
  type SourceEvent,
  type InteractionInput,
  type Interaction,
  type ModelCatalog,
  type ModelSelection,
} from '@harnessrc/protocol';

export class ZcodeClient {
  constructor(
    public socket: string,
    public generation = '',
  ) {}
  async request(method: string, params: Record<string, unknown> = {}) {
    const info = await stat(this.socket);
    if (!info.isSocket() || info.uid !== process.getuid?.() || info.mode & 0o077)
      throw new Error('Zcode socket must be private to the gateway account');
    return bridgeRequest(this.socket, method, { ...params, generation: this.generation });
  }
  call(method: string, params: Record<string, unknown>, operationId?: string) {
    return this.request('bridge/call', { method, params, ...(operationId ? { operationId } : {}) });
  }
}
export const zcodeRowSchema = z.object({
  sessionId: z.string(),
  title: z.string(),
  status: z.string(),
  mode: z.string(),
  sessionKind: z.string(),
  updatedAt: z.number(),
  workspace: z.object({ workspacePath: z.string(), workspaceKey: z.string() }),
  model: z.object({ providerId: z.string(), modelId: z.string() }).optional(),
});
export function zcodeStatus(status: string): Session['status'] {
  return status === 'running'
    ? 'working'
    : status === 'waiting'
      ? 'blocked'
      : status === 'completed'
        ? 'done'
        : status === 'error'
          ? 'done'
          : 'idle';
}
export function zcodeQuestionAnswers(interaction: InteractionInput, response: unknown) {
  const questions = z.array(dshQuestionSchema).parse(interaction.metadata.dshQuestions);
  const { answers } = dshAnswerSchema.parse(response);
  if (
    answers.length !== questions.length ||
    new Set(answers.map((a) => a.id)).size !== answers.length
  )
    throw new Error('Answer every Zcode question exactly once');
  return Object.fromEntries(
    questions.map((q) => {
      const a = answers.find((a) => a.id === q.id);
      if (
        !a ||
        (!a.selected.length && !a.custom?.trim()) ||
        (!q.multiSelect && a.selected.length + (a.custom?.trim() ? 1 : 0) > 1) ||
        new Set(a.selected).size !== a.selected.length ||
        a.selected.some((s) => !q.options?.some((o) => o.label === s))
      )
        throw new Error('Invalid Zcode question response');
      return [
        q.question,
        [...a.selected, ...(a.custom?.trim() ? [a.custom.trim()] : [])].join(', '),
      ];
    }),
  );
}
/** Full native messages plus native delta/turn events; stable IDs survive gateway reconnects. */
export function zcodeMessages(messages: any[]): SourceEvent[] {
  return messages.flatMap((m): SourceEvent[] => {
    const info = m.info;
    if (
      !info ||
      info.visibility === 'model-only' ||
      info.synthetic ||
      info.semantics?.uiVisibility === 'hidden'
    )
      return [];
    if (info.role === 'assistant' && !info.time?.completed) return [];
    const text = (m.parts ?? [])
      .filter((p: any) => p.type === 'text' && !p.ignored)
      .map((p: any) => p.text)
      .join('\n');
    if (!text) return [];
    return [
      {
        sourceId: `zcode:message:${info.messageId}`,
        timestamp: new Date(info.time.created).toISOString(),
        kind: info.role === 'user' ? 'user.message' : 'assistant.message',
        data: { text, itemId: info.messageId, model: info.model?.modelId },
      },
    ];
  });
}
export function zcodeEvents(events: any[]): SourceEvent[] {
  return events.flatMap((e): SourceEvent[] => {
    const d = e.payload ?? {};
    const base = {
      sourceId: `zcode:event:${e.eventId}`,
      timestamp: new Date(e.timestamp).toISOString(),
      turnId: e.turnId,
    };
    if (e.type === 'model.streaming' && d.kind === 'text_delta')
      return [
        { ...base, kind: 'assistant.delta', data: { text: d.delta, itemId: d.assistantMessageId } },
      ];
    if (e.type === 'model.streaming' && d.kind === 'tool_call')
      return [
        {
          ...base,
          sourceId: `zcode:tool:${d.toolCallId}:input`,
          kind: 'tool.invocation',
          data: { toolCallId: d.toolCallId, tool: d.toolName, input: d.input },
        },
      ];
    if (e.type === 'tool.updated') {
      if (d.kind === 'result' || d.kind === 'error')
        return [
          {
            ...base,
            sourceId: `zcode:tool:${d.toolCallId}:output`,
            kind: 'tool.output',
            data: {
              toolCallId: d.toolCallId,
              text:
                typeof d.result === 'string'
                  ? d.result
                  : JSON.stringify(d.result ?? d.output ?? d.error ?? ''),
              isError: d.kind === 'error',
            },
          },
        ];
      if (d.kind === 'scheduled')
        return [
          {
            ...base,
            sourceId: `zcode:tool:${d.toolCallId}:input`,
            kind: 'tool.invocation',
            data: { toolCallId: d.toolCallId, tool: d.toolName, input: d.input },
          },
        ];
    }
    if (e.type === 'part.delta' && (!d.field || d.field === 'text'))
      return [{ ...base, kind: 'assistant.delta', data: { text: d.delta, itemId: d.messageId } }];
    if (['turn.started', 'turn.completed', 'turn.failed'].includes(e.type))
      return [{ ...base, kind: e.type, data: { text: d.error?.message, inputId: d.inputId } }];
    if (e.type === 'part.upserted' && d.part?.type === 'tool') {
      const p = d.part,
        state = p.state;
      if (['completed', 'error'].includes(state.status))
        return [
          {
            ...base,
            sourceId: `zcode:tool:${p.callId}:output`,
            kind: 'tool.output',
            data: {
              toolCallId: p.callId,
              text: state.output ?? state.error ?? '',
              isError: state.status === 'error',
            },
          },
        ];
      return [
        {
          ...base,
          sourceId: `zcode:tool:${p.callId}:input`,
          kind: 'tool.invocation',
          data: { toolCallId: p.callId, tool: p.tool, input: state.input },
        },
      ];
    }
    return [];
  });
}
export class ZcodeAdapter implements Adapter {
  capabilities = capabilities([
    'readConversation',
    'streamConversation',
    'sendMessage',
    'queueTask',
    'interruptTurn',
    'changeModel',
    'answerQuestion',
    'approveAction',
    'rejectAction',
  ]);
  private seq = 0;
  private terminalInputs = new Map<string, 'completed' | 'failed'>();
  constructor(
    private native: ZcodeClient,
    private checkBinding: (s: Session) => Promise<void>,
  ) {}
  async snapshot(s: Session) {
    return this.native.call('session/read', { sessionId: s.nativeSessionId, messageLimit: 1000 });
  }
  async turnState(s: Session) {
    return zcodeStatus((await this.snapshot(s)).session.status);
  }
  async read(s: Session) {
    const { events } = await this.native.call('session/events', {
      sessionId: s.nativeSessionId,
      afterSeq: this.seq,
      limit: 1000,
    });
    for (const e of events) {
      this.seq = Math.max(this.seq, e.seq);
      if (e.payload?.inputId && ['turn.completed', 'turn.failed'].includes(e.type))
        this.terminalInputs.set(
          e.payload.inputId,
          e.type === 'turn.failed' ? 'failed' : 'completed',
        );
    }
    const snapshot = await this.snapshot(s);
    const usage = zcodeUsage(snapshot.projection);
    return [
      ...zcodeEvents(events),
      ...zcodeMessages(snapshot.messages),
      ...(usage
        ? [
            {
              sourceId: `zcode:usage:${createHash('sha256').update(JSON.stringify(usage)).digest('hex')}`,
              timestamp: new Date().toISOString(),
              kind: 'progress' as const,
              data: { usage, nativeMeta: true },
            },
          ]
        : []),
    ];
  }
  async send(s: Session, task: Task) {
    await this.checkBinding(s);
    if (!['idle', 'done'].includes(await this.turnState(s)))
      throw new DeliveryDeferred('Zcode is busy. Queue a follow-up or stop the current turn.');
    const result = await this.native.call(
      'session/send',
      { sessionId: s.nativeSessionId, inputId: task.id, content: task.prompt },
      task.id,
    );
    if (result.accepted !== true || result.sessionId !== s.nativeSessionId)
      throw new Error('Zcode did not confirm this message');
    return { correlation: task.id };
  }
  async reconcile(
    _s: Session,
    task: Task,
  ): Promise<'completed' | 'failed' | 'running' | 'uncertain'> {
    return (
      this.terminalInputs.get(task.id) ?? (task.status === 'uncertain' ? 'uncertain' : 'running')
    );
  }
  async interrupt(s: Session) {
    await this.checkBinding(s);
    await this.native.call('session/stop', { sessionId: s.nativeSessionId });
  }
  async models(s: Session): Promise<ModelCatalog> {
    const snapshot = await this.native.call('session/resume', { sessionId: s.nativeSessionId }),
      model = snapshot.settings.model;
    const groups = new Map<string, ModelCatalog['groups'][number]>();
    for (const m of model.available) {
      if (m.disabledReason) continue;
      const group: ModelCatalog['groups'][number] = groups.get(m.ref.providerId) ?? {
        id: m.ref.providerId,
        name: m.providerLabel ?? m.ref.providerId,
        models: [],
      };
      group.models.push({
        id: m.ref.modelId,
        name: m.label,
        reasoningEfforts: m.reasoning?.levels.map((v: any) => v.value),
        defaultReasoningEffort: m.reasoning?.defaultLevel,
      });
      groups.set(group.id, group);
    }
    const current = model.current && {
      provider: model.current.providerId,
      model: model.current.modelId,
      reasoningEffort: snapshot.settings.thoughtLevel.current,
    };
    return {
      groups: [...groups.values()],
      current,
      default: current ?? { provider: '', model: '' },
    };
  }
  async setModel(s: Session, selection: ModelSelection) {
    await this.checkBinding(s);
    const catalog = await this.models(s);
    const option = catalog.groups
      .find((g) => g.id === selection.provider)
      ?.models.find((m) => m.id === selection.model);
    if (
      !option ||
      (selection.reasoningEffort && !option.reasoningEfforts?.includes(selection.reasoningEffort))
    )
      throw new Error('Choose an available Zcode model');
    const level = selection.reasoningEffort ?? option.defaultReasoningEffort;
    await this.native.call('session/setModel', {
      sessionId: s.nativeSessionId,
      model: {
        providerId: selection.provider,
        modelId: selection.model,
        ...(level ? { options: { reasoningLevel: level } } : {}),
      },
    });
    const after = await this.models(s);
    if (
      after.current?.provider !== selection.provider ||
      after.current?.model !== selection.model ||
      (level && after.current?.reasoningEffort !== level)
    )
      throw new Error('Zcode model selection was not confirmed');
    return after;
  }
  async interactions(s: Session): Promise<InteractionInput[]> {
    const pending = await this.native.request('bridge/pending', { sessionId: s.nativeSessionId });
    return pending.map((r: any) => {
      const p = r.params;
      const approval = r.method === 'interaction/requestPermission';
      const questions =
        !approval && p.questions?.length
          ? p.questions.map((q: any, index: number) => ({ ...q, id: `q${index}` }))
          : undefined;
      return {
        nativeRequestId: p.requestId,
        turnId: p.turnId,
        route: 'zcode-native',
        type: approval ? 'command-approval' : 'free-text',
        prompt: approval
          ? `${p.toolName}: ${p.reason}\n${JSON.stringify(p.input)}`
          : [
              p.prompt,
              ...(p.questions ?? []).map(
                (q: any) => `${q.question}\n${q.options.map((o: any) => o.label).join(' / ')}`,
              ),
            ]
              .filter(Boolean)
              .join('\n'),
        choices: approval ? p.options.map((o: any) => ({ id: o.optionId, label: o.name })) : [],
        responseSchema: questions
          ? { type: 'object' }
          : approval
            ? { type: 'string', enum: p.options.map((o: any) => o.optionId) }
            : { type: 'string', minLength: 1 },
        expiresAt: '9999-12-31T23:59:59.999Z',
        metadata: questions ? { questionFormat: 'choice-batch', dshQuestions: questions } : {},
      };
    });
  }
  validateInteractionResponse(_s: Session, interaction: Interaction, response: unknown) {
    if (interaction.metadata.questionFormat === 'choice-batch')
      zcodeQuestionAnswers(interaction, response);
  }
  async respond(s: Session, interaction: Interaction, response: unknown) {
    await this.checkBinding(s);
    const pending = await this.native.request('bridge/pending', { sessionId: s.nativeSessionId });
    const r = pending.find((r: any) => r.params.requestId === interaction.nativeRequestId);
    if (!r) throw new Error('Zcode interaction is no longer pending');
    const option = r.params.options?.find((o: any) => o.optionId === response);
    if (r.method === 'interaction/requestPermission' && !option)
      throw new Error('Choose an offered Zcode approval');
    const answers =
      interaction.metadata.questionFormat === 'choice-batch'
        ? zcodeQuestionAnswers(interaction, response)
        : undefined;
    if (!option && !answers && (typeof response !== 'string' || !response.trim()))
      throw new Error('Enter a Zcode answer');
    await this.native.request('bridge/respond', {
      sessionId: s.nativeSessionId,
      requestId: interaction.nativeRequestId,
      response: option?.response ?? {
        action: 'accept',
        content: answers ? { answers } : { answer: response },
      },
    });
  }
}
