import { SlidersHorizontal, X } from 'lucide-react';
import type { SessionView } from '@harnessrc/protocol';
import {
  agentLabel,
  defaultFilters,
  filterSessions,
  isSaved,
  type SessionFilters as Filters,
} from './session-filters.ts';
export function SessionFilters({
  sessions,
  value,
  onChange,
  count,
}: {
  sessions: SessionView[];
  value: Filters;
  onChange: (value: Filters) => void;
  count: number;
}) {
  const update = (patch: Partial<Filters>) => onChange({ ...value, ...patch });
  const scoped = sessions.filter((s) => (value.scope === 'history') === isSaved(s));
  const agents = [...new Set(sessions.map((s) => s.harness))].sort();
  const extra = [value.status, value.host, value.cwd].filter((v) => v !== 'all').length;
  const filtered = value.agent !== 'all' || extra > 0 || !!value.search;
  return (
    <div className="session-filters">
      <div className="session-scope" role="group" aria-label="Session collection">
        {(['live', 'history'] as const).map((scope) => (
          <button
            key={scope}
            type="button"
            aria-pressed={value.scope === scope}
            onClick={() => update({ scope, status: 'all', host: 'all', cwd: 'all' })}
          >
            {scope === 'live' ? 'Live' : 'History'}{' '}
            <span>{sessions.filter((s) => (scope === 'history') === isSaved(s)).length}</span>
          </button>
        ))}
      </div>
      <div className="agent-choices" role="group" aria-label="Filter by agent">
        {['all', ...agents].map((agent) => {
          const total = scoped.filter((s) => agent === 'all' || s.harness === agent).length;
          return (
            <button
              key={agent}
              type="button"
              aria-pressed={value.agent === agent}
              aria-label={`${agent === 'all' ? 'All agents' : agentLabel(agent)}, ${total} sessions`}
              onClick={() => update({ agent, status: 'all', host: 'all', cwd: 'all' })}
            >
              {agent === 'all' ? 'All' : agentLabel(agent)} <span>{total}</span>
            </button>
          );
        })}
      </div>
      <div className="filter-summary">
        <span role="status">
          {count} {value.scope === 'history' ? 'saved' : 'live'} session{count === 1 ? '' : 's'}
        </span>
        {filtered && (
          <button
            type="button"
            aria-label="Clear session filters"
            onClick={() => onChange({ ...defaultFilters, scope: value.scope })}
          >
            <X size={16} /> Clear
          </button>
        )}
        <details className="session-filter-options">
          <summary>
            <SlidersHorizontal size={17} /> Filters{extra > 0 ? ` (${extra})` : ''}
          </summary>
          <div className="session-filter-fields">
            <label>
              Status
              <select
                aria-label="Filter by status"
                value={value.status}
                onChange={(e) => update({ status: e.target.value })}
              >
                <option value="all">Any status</option>
                <option value="working">Working</option>
                <option value="attention">Needs input</option>
                <option value="idle">Idle</option>
                <option value="done">Done</option>
                <option value="offline">Offline</option>
              </select>
            </label>
            <label>
              Host
              <select
                aria-label="Filter by host"
                value={value.host}
                onChange={(e) => update({ host: e.target.value })}
              >
                <option value="all">All hosts</option>
                {[...new Set(scoped.map((s) => s.hostId))].sort().map((h) => (
                  <option key={h}>{h}</option>
                ))}
              </select>
            </label>
            <label>
              Directory
              <select
                aria-label="Filter by directory"
                value={value.cwd}
                onChange={(e) => update({ cwd: e.target.value })}
              >
                <option value="all">All directories</option>
                {[
                  ...new Set(
                    filterSessions(sessions, {
                      ...defaultFilters,
                      scope: value.scope,
                      agent: value.agent,
                    })
                      .map((s) => s.cwd)
                      .filter(Boolean),
                  ),
                ]
                  .sort()
                  .map((c) => (
                    <option key={c}>{c}</option>
                  ))}
              </select>
            </label>
          </div>
        </details>
      </div>
    </div>
  );
}
