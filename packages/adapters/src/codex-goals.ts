import { z } from 'zod';
import type { GoalChange, GoalSnapshot, Session } from '@harnessrc/protocol';
import type { CodexDaemon } from './codex-daemon.ts';

const goalSchema = z.object({
  threadId: z.string(),
  objective: z.string(),
  status: z.enum(['active', 'paused', 'blocked', 'usageLimited', 'budgetLimited', 'complete']),
  tokensUsed: z.number().nonnegative(),
  tokenBudget: z.number().nullish(),
  timeUsedSeconds: z.number().nonnegative(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
/** Uses the existing native owner; never starts/resumes a thread or submits a chat prompt. */
export class CodexGoals {
  constructor(
    private native: Pick<CodexDaemon, 'request'>,
    private assertOwner: (s: Session) => Promise<void>,
  ) {}
  async read(s: Session): Promise<GoalSnapshot> {
    await this.assertOwner(s);
    let result;
    try {
      result = await this.native.request('thread/goal/get', { threadId: s.nativeSessionId });
    } catch (error) {
      if (/method not found|unknown (?:variant|method)|unsupported method/i.test(String(error)))
        return {
          supported: false,
          reason:
            'This Codex server does not expose goals. Update its native server to use goals in Relay.',
        };
      throw error;
    }
    const { goal } = z.object({ goal: goalSchema.nullish() }).parse(result);
    if (goal && goal.threadId !== s.nativeSessionId)
      throw new Error('Native goal belongs to a different thread.');
    await this.assertOwner(s);
    return { supported: true, goal: goal ?? null };
  }
  async set(s: Session, change: GoalChange): Promise<GoalSnapshot> {
    const current = await this.read(s);
    if (!current.supported) throw new Error(current.reason);
    if (!change.objective && !current.goal)
      throw new Error('No goal is set. Use /goal followed by an objective.');
    const { thread } = await this.native.request('thread/read', {
      threadId: s.nativeSessionId,
      includeTurns: false,
    });
    if (thread?.id !== s.nativeSessionId || !['idle', 'active'].includes(thread.status?.type))
      throw new Error(
        'Codex thread is not loaded. Reconnect its native session before changing the goal.',
      );
    await this.assertOwner(s);
    if (change.clear) {
      z.object({ cleared: z.boolean() }).parse(
        await this.native.request('thread/goal/clear', {
          threadId: s.nativeSessionId,
          origin: 'user',
        }),
      );
    } else {
      const result = z.object({ goal: goalSchema }).parse(
        await this.native.request('thread/goal/set', {
          threadId: s.nativeSessionId,
          origin: 'user',
          ...(change.objective
            ? { objective: change.objective, status: 'active' }
            : { status: change.status }),
        }),
      );
      if (result.goal.threadId !== s.nativeSessionId)
        throw new Error('Native goal acknowledgement belongs to a different thread.');
    }
    const updated = await this.read(s);
    if (
      (change.clear && updated.goal) ||
      (change.objective && updated.goal?.objective !== change.objective) ||
      (change.status === 'paused' && updated.goal?.status !== 'paused')
    )
      throw new Error('Codex has not confirmed the goal change. Refresh its goal before retrying.');
    return updated;
  }
}
