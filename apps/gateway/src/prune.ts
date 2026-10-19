import type { Session } from '@harnessrc/protocol';
import type { Store } from '@harnessrc/storage';
import type { HerdrClient } from '@harnessrc/herdr';

export const pruneAfterDays = 7;

/** A week without activity retires a session: its Herdr pane closes and Relay archives it.
 * Pinned sessions, sessions with queued work, and working or blocked agents are never touched. */
export function pruneCandidates(sessions: Session[], keep: Set<string>, now = Date.now()) {
  const cutoff = now - pruneAfterDays * 86_400_000;
  const stale = (s: Session) =>
    Date.parse(s.lastActivity) < cutoff &&
    !keep.has(s.id) &&
    s.status !== 'working' &&
    s.status !== 'blocked';
  const panes = new Map<string, Session[]>();
  for (const s of sessions) {
    const key = `${s.hostId}\0${s.paneId}`;
    panes.set(key, [...(panes.get(key) ?? []), s]);
  }
  return {
    archive: sessions.filter(stale).map((s) => s.id),
    // A pane closes only when every session that ever lived in it is stale and one is still running.
    close: [...panes.values()]
      .filter((ss) => ss.every(stale) && ss.some((s) => s.connected))
      .map((ss) => ({ hostId: ss[0].hostId, paneId: ss[0].paneId })),
  };
}

export async function prune(store: Store, clients: Map<string, HerdrClient>, now = Date.now()) {
  const prefs = store.db
    .prepare('SELECT session_id,pinned,archived FROM session_preferences')
    .all();
  const queued = store.db
    .prepare(
      "SELECT DISTINCT session_id FROM tasks WHERE status IN ('pending','running','dispatching','uncertain')",
    )
    .all();
  const keep = new Set([
    ...prefs.filter((r) => r.pinned).map((r) => r.session_id as string),
    ...queued.map((r) => r.session_id as string),
  ]);
  const archived = new Set(prefs.filter((r) => r.archived).map((r) => r.session_id as string));
  const { archive, close } = pruneCandidates(store.sessions(), keep, now);
  const closed: string[] = [];
  for (const { hostId, paneId } of close) {
    const client = clients.get(hostId);
    if (!client?.host.connected) continue;
    try {
      const { snapshot } = await client.request('session.snapshot');
      const pane = snapshot.panes.find((p: any) => p.pane_id === paneId);
      if (!pane) continue;
      // Closing the tab also clears the sidebar and shell an agent leaves behind.
      const others = snapshot.panes.filter(
        (p: any) => p.tab_id === pane.tab_id && p.pane_id !== paneId && p.agent,
      );
      if (others.length) await client.request('pane.close', { pane_id: paneId }, 15000);
      else await client.request('tab.close', { tab_id: pane.tab_id }, 15000);
      closed.push(`${hostId}:${paneId}`);
    } catch (error) {
      console.warn(`prune: could not close ${paneId} on ${hostId}: ${(error as Error).message}`);
    }
  }
  const fresh = archive.filter((id) => !archived.has(id));
  store.transaction(() => {
    for (const id of fresh) {
      store.db.prepare('INSERT OR IGNORE INTO session_preferences(session_id) VALUES(?)').run(id);
      store.db.prepare('UPDATE session_preferences SET archived=1 WHERE session_id=?').run(id);
    }
    if (fresh.length || closed.length)
      store.audit('system', 'session.prune', null, { archived: fresh, closed });
  });
  for (const id of fresh) store.emit('change', id);
  return { archived: fresh, closed };
}
