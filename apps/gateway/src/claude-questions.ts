import { z } from 'zod';
import type { Interaction } from '@harnessrc/protocol';
import type { Runtime } from './runtime.ts';
const questionSchema = z.object({
  question: z.string().min(1).max(12000),
  header: z.string().optional(),
  multiSelect: z.boolean().default(false),
  options: z
    .array(
      z.object({
        label: z.string().min(1).max(1000),
        description: z.string().max(12000).optional(),
      }),
    )
    .min(1)
    .max(20),
});
const hookPayload = z.object({
  session_id: z.string(),
  hook_event_name: z.enum(['PreToolUse', 'PostToolUse', 'PostToolUseFailure']),
  tool_use_id: z.string().min(1).max(200),
  sender_pids: z.array(z.number().int().positive()).max(32),
  agent_id: z.string().optional(),
});
const payloadSchema = z.discriminatedUnion('tool_name', [
  hookPayload.extend({
    tool_name: z.literal('AskUserQuestion'),
    tool_input: z
      .object({
        questions: z
          .array(questionSchema)
          .min(1)
          .max(4)
          .refine((q) => new Set(q.map((v) => v.question)).size === q.length),
      })
      .passthrough(),
  }),
  hookPayload.extend({
    tool_name: z.literal('ExitPlanMode'),
    tool_input: z.object({ plan: z.string().max(200000).optional() }).passthrough(),
  }),
]);
const responseSchema = z.object({
  answers: z
    .array(
      z.object({
        id: z.string(),
        selected: z.array(z.string()).max(20),
        custom: z.string().max(32000),
      }),
    )
    .min(1)
    .max(4),
});
export class ClaudeQuestions {
  constructor(private runtime: Runtime) {}
  answers(i: Interaction, response: unknown) {
    const questions = z
      .array(questionSchema.extend({ id: z.string() }))
      .parse(i.metadata.dshQuestions);
    let values: z.infer<typeof responseSchema>['answers'];
    if (Array.isArray((response as any)?.answers)) values = responseSchema.parse(response).answers;
    else {
      // Previous Android releases use the existing Codex-style question batch.
      const legacy = z
        .object({
          answers: z.record(
            z.string(),
            z.object({ answers: z.array(z.string().max(32000)).min(1).max(20) }).strict(),
          ),
        })
        .strict()
        .parse(response);
      values = Object.entries(legacy.answers).map(([id, value]) => {
        const question = questions.find((q) => q.id === id);
        const selected = value.answers.filter((a) => question?.options.some((o) => o.label === a));
        const custom = value.answers.filter((a) => !selected.includes(a)).join(', ');
        return { id, selected, custom };
      });
    }
    if (
      values.length !== questions.length ||
      new Set(values.map((v) => v.id)).size !== values.length
    )
      throw new Error('Answer every question exactly once');
    return Object.fromEntries(
      questions.map((q) => {
        const a = values.find((v) => v.id === q.id);
        if (
          !a ||
          a.selected.some((s) => !q.options.some((o) => o.label === s)) ||
          new Set(a.selected).size !== a.selected.length
        )
          throw new Error('Invalid question choices');
        if (!q.multiSelect && (a.selected.length > 1 || (a.selected.length && a.custom.trim())))
          throw new Error('Select one answer or enter a custom response');
        const answer = [...a.selected, ...(a.custom.trim() ? [a.custom.trim()] : [])].join(', ');
        if (!answer) throw new Error('Answer every question');
        return [q.question, answer];
      }),
    );
  }
  async handle(method: string, invocation: string, input: unknown) {
    const h = payloadSchema.parse(input);
    if (h.agent_id) return { output: {} };
    const matches = this.runtime.store
      .sessions()
      .filter((s) => s.harness === 'claude' && s.connected && s.nativeSessionId === h.session_id);
    if (matches.length !== 1)
      throw new Error('Question is not uniquely bound to a live Claude process');
    const s = matches[0];
    await this.runtime.assertBinding(s);
    if (!s.processIdentity || !h.sender_pids.includes(Number(s.processIdentity.split(':')[1])))
      throw new Error('Question hook does not descend from the bound process');
    const nativeId = `claude-question:${h.tool_use_id}`;
    let interaction = this.runtime.store
      .interactions(s.id)
      .find((i) => i.nativeRequestId === nativeId);
    if (method === 'question-close') {
      if (
        interaction &&
        interaction.generation === s.generation &&
        ['pending', 'answered', 'responding', 'uncertain'].includes(interaction.status)
      ) {
        interaction.status = h.hook_event_name === 'PostToolUseFailure' ? 'stale' : 'resolved';
        this.runtime.store.saveInteraction(interaction);
      }
      return { output: {} };
    }
    if (h.hook_event_name !== 'PreToolUse')
      throw new Error('Question needs an exact PreToolUse invocation');
    if (
      interaction &&
      (interaction.generation !== s.generation || interaction.metadata.invocation !== invocation)
    )
      throw new Error('Question invocation changed');
    const plan = h.tool_name === 'ExitPlanMode';
    if (!interaction || interaction.status === 'expired')
      interaction = this.runtime.broker.open(s.id, {
        nativeRequestId: nativeId,
        type: plan ? 'command-approval' : 'single-choice',
        prompt:
          h.tool_name === 'ExitPlanMode'
            ? `Approve this plan and continue?${h.tool_input.plan ? '\n\n' + h.tool_input.plan : ''}`
            : h.tool_input.questions.map((q) => q.question).join('\n\n'),
        ...(plan
          ? {
              choices: [
                { id: 'allow', label: 'Approve plan and continue' },
                { id: 'deny', label: 'Keep planning' },
              ],
            }
          : {}),
        route: 'claude-hook',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        responseSchema: plan
          ? { type: 'string', enum: ['allow', 'deny'] }
          : {
              type: 'object',
              required: ['answers'],
              additionalProperties: false,
              properties: { answers: {} },
            },
        metadata:
          h.tool_name === 'ExitPlanMode'
            ? {
                tool: h.tool_name,
                input: h.tool_input,
                invocation,
                toolUseId: h.tool_use_id,
              }
            : {
                questionFormat: 'choice-batch',
                questions: h.tool_input.questions.map((q, index) => ({ ...q, id: String(index) })),
                invocation,
                toolUseId: h.tool_use_id,
                dshQuestions: h.tool_input.questions.map((q, index) => ({
                  ...q,
                  id: String(index),
                })),
              },
      });
    if (method === 'question-ack')
      return { output: {}, status: this.runtime.broker.acknowledge(interaction.id).status };
    interaction = this.runtime.broker.heartbeat(interaction.id);
    s.capabilities = {
      ...s.capabilities,
      answerQuestion: true,
      ...(plan ? { approveAction: true, rejectAction: true } : {}),
    };
    this.runtime.store.saveSession(s);
    if (interaction.status !== 'answered') return { status: interaction.status, output: {} };
    return {
      status: 'answered',
      output: {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          ...(h.tool_name === 'ExitPlanMode'
            ? interaction.response === 'allow'
              ? { permissionDecision: 'allow', updatedInput: h.tool_input }
              : {
                  permissionDecision: 'deny',
                  permissionDecisionReason: 'The user chose to keep planning in Relay.',
                }
            : {
                permissionDecision: 'allow',
                updatedInput: {
                  ...h.tool_input,
                  answers: this.answers(interaction, interaction.response),
                },
              }),
        },
      },
    };
  }
}
