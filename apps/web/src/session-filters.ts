import type { SessionView } from '@harnessrc/protocol';
export const agentLabel = (h: string) =>
  ({
    claude: 'Claude Code',
    codex: 'Codex',
    dsh: 'DSH',
    omp: 'OMP / Pi',
    hermes: 'Hermes',
    opencode: 'OpenCode',
  })[h] ?? h;
export type SessionFilters = {
  scope: 'live' | 'history';
  agent: string;
  status: string;
  host: string;
  cwd: string;
  search: string;
};
export const defaultFilters: SessionFilters = {
  scope: 'live',
  agent: 'all',
  status: 'all',
  host: 'all',
  cwd: 'all',
  search: '',
};
export const isSaved = (s: SessionView) =>
  !!s.archived || s.presence === 'saved' || s.status === 'ended';
export function filterSessions(sessions: SessionView[], f: SessionFilters) {
  const words = f.search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return sessions
    .filter((s) => {
      if ((f.scope === 'history') !== isSaved(s)) return false;
      if (f.agent !== 'all' && s.harness !== f.agent) return false;
      if (f.host !== 'all' && s.hostId !== f.host) return false;
      if (f.cwd !== 'all' && s.cwd !== f.cwd) return false;
      if (
        f.status === 'attention'
          ? s.status !== 'blocked' && !s.pendingCount
          : f.status !== 'all' && s.status !== f.status
      )
        return false;
      const haystack = [
        s.project,
        s.sessionName,
        s.relayName,
        s.agentPreset,
        s.tabName,
        s.cwd,
        s.harness,
        agentLabel(s.harness),
        s.model,
        s.hostId,
        s.status,
      ]
        .join(' ')
        .toLowerCase();
      return words.every((word) => haystack.includes(word));
    })
    .sort(
      (a, b) =>
        Number(!!b.pinned) - Number(!!a.pinned) ||
        Date.parse(b.lastActivity) - Date.parse(a.lastActivity) ||
        a.id.localeCompare(b.id),
    );
}
