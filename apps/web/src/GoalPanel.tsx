import { useQuery } from '@tanstack/react-query';
import { api } from '@harnessrc/client-sdk';
import type { GoalSnapshot } from '@harnessrc/protocol';

const labels: Record<string, string> = {
  active: 'Running',
  paused: 'Paused',
  blocked: 'Blocked',
  usageLimited: 'Usage limit reached',
  budgetLimited: 'Token budget reached',
  complete: 'Completed',
};
export function GoalPanel({
  sessionId,
  canControl,
  pending,
  command,
}: {
  sessionId: string;
  canControl: boolean;
  pending: boolean;
  command: (line: string) => void;
}) {
  const query = useQuery({
    queryKey: ['goal', sessionId],
    queryFn: () => api<GoalSnapshot>(`/api/sessions/${sessionId}/goal`),
    refetchInterval: 5000,
    retry: false,
  });
  const goal = query.data?.goal;
  return (
    <section className="plan-card goal-panel" aria-label="Session goal">
      <h2>Goal {goal && <span className="muted">· {labels[goal.status] ?? goal.status}</span>}</h2>
      {query.isPending && <p role="status">Loading goal…</p>}
      {query.error && (
        <div role="alert">
          <p>Could not load the current goal. {query.error.message}</p>
          <button className="secondary" onClick={() => void query.refetch()}>
            Retry goal
          </button>
        </div>
      )}
      {query.data && !query.data.supported && <p className="muted">{query.data.reason}</p>}
      {query.data?.supported && !goal && (
        <p>
          No goal set. Send <code>/goal</code> followed by your objective to start one.
        </p>
      )}
      {goal && (
        <>
          <p className="goal-objective">{goal.objective}</p>
          <p className="muted">
            {goal.tokensUsed.toLocaleString()}{' '}
            {goal.tokenBudget != null ? `/ ${goal.tokenBudget.toLocaleString()} ` : ''}tokens ·{' '}
            {Math.floor(goal.timeUsedSeconds / 60)}m {Math.floor(goal.timeUsedSeconds % 60)}s
            elapsed
          </p>
          {goal.tokenBudget != null && goal.tokenBudget > 0 && (
            <progress
              aria-label="Goal token budget"
              max={goal.tokenBudget}
              value={Math.min(goal.tokensUsed, goal.tokenBudget)}
            />
          )}
          {canControl &&
            ['active', 'paused', 'blocked', 'usageLimited', 'budgetLimited'].includes(
              goal.status,
            ) && (
              <button
                className="secondary"
                disabled={pending}
                onClick={() => command(goal.status === 'active' ? '/goal pause' : '/goal resume')}
              >
                {pending
                  ? 'Updating goal…'
                  : goal.status === 'active'
                    ? 'Pause goal'
                    : 'Resume goal'}
              </button>
            )}
        </>
      )}
    </section>
  );
}
