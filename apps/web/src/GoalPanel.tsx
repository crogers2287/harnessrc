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
  cleared: 'Cleared',
  failed: 'Failed',
};
export function GoalPanel({
  sessionId,
  canControl,
  pending,
  command,
  cliReady = true,
}: {
  sessionId: string;
  canControl: boolean;
  pending: boolean;
  command: (line: string) => void;
  cliReady?: boolean;
}) {
  const query = useQuery({
    queryKey: ['goal', sessionId],
    queryFn: () => api<GoalSnapshot>(`/api/sessions/${sessionId}/goal`),
    refetchInterval: 5000,
    retry: false,
  });
  const goal = query.data?.goal;
  const controls = query.data?.controls ?? ['pause', 'resume'];
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
          {query.data.reason || (
            <>
              No goal set. Send <code>/goal</code> followed by your objective to start one.
            </>
          )}
        </p>
      )}
      {goal && (
        <>
          <p className="goal-objective">{goal.objective}</p>
          {(goal.tokensUsed != null || goal.timeUsedSeconds != null) && (
            <p className="muted">
              {[
                goal.tokensUsed != null
                  ? `${goal.tokensUsed.toLocaleString()}${goal.tokenBudget != null ? ` / ${goal.tokenBudget.toLocaleString()}` : ''} tokens`
                  : '',
                goal.timeUsedSeconds != null
                  ? `${Math.floor(goal.timeUsedSeconds / 60)}m ${Math.floor(goal.timeUsedSeconds % 60)}s elapsed`
                  : '',
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          )}
          {goal.tokenBudget != null && goal.tokenBudget > 0 && (
            <progress
              aria-label="Goal token budget"
              max={goal.tokenBudget}
              value={Math.min(goal.tokensUsed ?? 0, goal.tokenBudget)}
            />
          )}
          {canControl &&
            controls.includes(goal.status === 'active' ? 'pause' : 'resume') &&
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
          {canControl && controls.includes('clear') && goal.status === 'active' && (
            <>
              <button
                className="secondary"
                disabled={pending || !cliReady}
                onClick={() => command('/goal clear')}
              >
                Clear goal
              </button>
              {!cliReady && (
                <p className="muted">
                  Resolve the pending question before changing the Claude goal.
                </p>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
