import { createHash, randomUUID } from 'node:crypto';
import type { InteractionInput } from '@harnessrc/protocol';
import type { CodexDaemon } from './codex-daemon.ts';
import { codexRequestInteraction } from './codex.ts';

/** Codex async questions are message items, not JSON-RPC server requests.
 * Match the native TUI's AnsweredQuestion envelope and active-turn steering.
 */
export class CodexAsyncQuestions {
  constructor(private native: Pick<CodexDaemon, 'request'>) {}

  async list(threadId: string): Promise<InteractionInput[]> {
    const result = await this.native.request('thread/turns/list', {
      threadId,
      limit: 1,
      sortDirection: 'desc',
      itemsView: 'full',
    });
    if (!Array.isArray(result.data)) throw new Error('Native question state is unavailable');
    const turn = result.data.find((t: any) => t.status === 'inProgress');
    if (!turn) return [];
    if (!Array.isArray(turn.items)) throw new Error('Native question items are unavailable');
    const answered = new Set<string>();
    for (const item of turn.items) {
      if (item.type !== 'userMessage') continue;
      for (const part of item.content ?? []) {
        if (part.type !== 'text') continue;
        const match =
          /^\s*<send_user_message_question_reply>\s*([\s\S]*?)\s*<\/send_user_message_question_reply>\s*$/.exec(
            part.text ?? '',
          );
        if (!match) continue;
        try {
          const replies = JSON.parse(match[1]);
          if (Array.isArray(replies))
            for (const r of replies)
              if (typeof r.questionItemId === 'string') answered.add(r.questionItemId);
        } catch {
          /* Ordinary user text is not a structured answer. */
        }
      }
    }
    const pending: InteractionInput[] = [];
    for (const item of turn.items) {
      if (
        item.type !== 'agentMessage' ||
        item.delivery !== 'async' ||
        !Array.isArray(item.questions)
      )
        continue;
      for (const [index, question] of item.questions.entries()) {
        if (typeof item.id !== 'string' || typeof question.title !== 'string') continue;
        const questionId = JSON.stringify(['request_user_input_async', item.id, index]);
        if (answered.has(questionId) || answered.has(item.id)) continue;
        const nativeRequestId =
          'async:' +
          createHash('sha256')
            .update(JSON.stringify([threadId, turn.id, questionId]))
            .digest('hex');
        const input = codexRequestInteraction({
          id: nativeRequestId,
          method: 'item/tool/requestUserInput',
          params: {
            turnId: turn.id,
            itemId: item.id,
            questions: [
              {
                id: questionId,
                question: question.title,
                options: (Array.isArray(question.options) ? question.options : [])
                  .filter((x: unknown) => typeof x === 'string')
                  .map((label: string) => ({ label, description: '' })),
              },
            ],
          },
        })!;
        pending.push({
          ...input,
          route: 'codex-native',
          expiresAt: '2100-01-01T00:00:00.000Z',
          metadata: { ...input.metadata, asyncQuestion: true },
        });
      }
    }
    return pending;
  }

  async respond(
    threadId: string,
    requestId: string,
    turnId: string | undefined,
    response: unknown,
  ) {
    const pending = (await this.list(threadId)).find(
      (q) => q.nativeRequestId === requestId && q.turnId === turnId,
    );
    if (!pending) throw new Error('Native question is no longer available');
    const question = (pending.metadata.questions as any[])[0];
    const answers = (response as any)?.answers?.[question.id]?.answers;
    if (
      !Array.isArray(answers) ||
      answers.length !== 1 ||
      typeof answers[0] !== 'string' ||
      !answers[0].trim()
    )
      throw new Error('A single answer is required');
    const text = `<send_user_message_question_reply>\n${JSON.stringify([{ questionItemId: question.id, question: question.question, answer: answers[0] }])}\n</send_user_message_question_reply>`;
    const accepted = await this.native.request('turn/steer', {
      threadId,
      expectedTurnId: pending.turnId,
      clientUserMessageId: randomUUID(),
      input: [{ type: 'text', text }],
    });
    if (accepted.turnId !== pending.turnId)
      throw new Error('Question response delivery is unconfirmed; do not resend');
  }
}
