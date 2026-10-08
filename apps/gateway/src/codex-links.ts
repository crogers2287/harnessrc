import { randomUUID } from 'node:crypto';
import type { Agent, HerdrClient } from '@harnessrc/herdr';
import type { Session } from '@harnessrc/protocol';
import type { Store } from '@harnessrc/storage';
import { nativeModel } from '../../../packages/adapters/src/transcripts.ts';
import { CodexDaemon } from '../../../packages/adapters/src/codex-daemon.ts';

type Native = { request: CodexDaemon['request']; close?: () => void };
type Link = {
  threadId: string;
  terminalId: string;
  process: string;
  name: string;
  verifiedAt: number;
  model?: string;
};
function titleMatches(agent: Agent, name: string) {
  const title = agent.terminal_title_stripped ?? '';
  return title === name || title.startsWith(`${name} | `);
}
function identity(info: any) {
  if (
    !Number.isInteger(info.shell_pid) ||
    !Number.isInteger(info.foreground_process_group_id) ||
    !info.foreground_processes?.some(
      (p: any) => p.name === 'codex' && p.pid === info.foreground_process_group_id,
    )
  )
    throw new Error('Codex foreground process is not verifiable');
  return `${info.shell_pid}:${info.foreground_process_group_id}`;
}

/** Bind metadata with a native nonce echo, never by a guessed CWD/title match.
 * The title only chooses candidates. Conversations still come from native JSONL.
 * Every dispatch repeats the proof; periodic checks detect terminal thread switches.
 */
export class CodexLinks {
  diagnostic?: string;
  private tail: Promise<unknown> = Promise.resolve();
  private nextDiscovery = 0;
  constructor(
    private host: string,
    private store: Store,
    private native: Native,
  ) {}
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.tail.then(fn, fn);
    this.tail = run.catch(() => {});
    return run;
  }
  private links(): Link[] {
    return this.store.db
      .prepare('SELECT body FROM codex_terminal_links WHERE host_id=?')
      .all(this.host)
      .map((r) => JSON.parse(r.body as string));
  }
  private save(link: Link) {
    this.store.db
      .prepare(
        'INSERT INTO codex_terminal_links VALUES(?,?,?) ON CONFLICT(host_id,terminal_id) DO UPDATE SET body=excluded.body',
      )
      .run(this.host, link.terminalId, JSON.stringify(link));
  }
  private forget(terminal: string) {
    // Keep a tombstone so a stale Herdr-reported native ID is never trusted on restart.
    this.save({ terminalId: terminal, threadId: '', process: '', name: '', verifiedAt: 0 });
  }
  private async recover() {
    for (const row of this.store.db
      .prepare('SELECT * FROM codex_name_probes WHERE host_id=?')
      .all(this.host)) {
      const { thread } = await this.native.request('thread/read', {
        threadId: row.thread_id,
        includeTurns: false,
      });
      // A concurrent user rename wins. Never overwrite it during recovery.
      if (thread.name === row.marker)
        await this.native.request('thread/name/set', {
          threadId: row.thread_id,
          name: row.original_name,
        });
      this.store.db
        .prepare('DELETE FROM codex_name_probes WHERE host_id=? AND thread_id=?')
        .run(this.host, row.thread_id);
    }
  }
  private async owner(client: HerdrClient, agent: Agent) {
    const latest = (await client.request('agent.get', { target: agent.pane_id })).agent;
    if (latest.terminal_id !== agent.terminal_id || latest.agent !== 'codex')
      throw new Error('Codex terminal was replaced');
    return identity(
      (await client.request('pane.process_info', { pane_id: agent.pane_id })).process_info,
    );
  }
  private async prove(client: HerdrClient, agent: Agent, threadId: string): Promise<Link> {
    const process = await this.owner(client, agent);
    const { thread } = await this.native.request('thread/read', { threadId, includeTurns: false });
    if (thread.id !== threadId || typeof thread.name !== 'string' || !thread.name.trim())
      throw new Error('Native title linking requires a named Codex thread');
    const marker = `Relay link ${randomUUID()}`;
    this.store.db
      .prepare('INSERT INTO codex_name_probes VALUES(?,?,?,?)')
      .run(this.host, threadId, thread.name, marker);
    let proven = false;
    try {
      await this.native.request('thread/name/set', { threadId, name: marker });
      for (let attempt = 0; attempt < 12; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        const { agents } = await client.snapshot();
        const echoes = agents.filter((a) => a.agent === 'codex' && titleMatches(a, marker));
        if (echoes.length > 1)
          throw new Error('Multiple Codex terminals share this thread; control disabled');
        if (echoes.length === 1) {
          if (
            echoes[0].terminal_id !== agent.terminal_id ||
            (await this.owner(client, agent)) !== process
          )
            throw new Error('Native thread belongs to another terminal or process');
          proven = true;
          break;
        }
      }
      if (!proven) throw new Error('Codex terminal did not confirm the native thread');
    } finally {
      await this.recover();
    }
    // Wait for restoration to reach the terminal too, and recheck the foreground owner.
    for (let attempt = 0; attempt < 12; attempt++) {
      const current = (await client.request('agent.get', { target: agent.pane_id })).agent;
      if (titleMatches(current, thread.name) && (await this.owner(client, agent)) === process)
        return {
          terminalId: agent.terminal_id,
          threadId,
          process,
          name: thread.name,
          verifiedAt: Date.now(),
          model: nativeModel(thread.model),
        };
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('Codex terminal changed during identity verification');
  }
  async refresh(client: HerdrClient, agents: Agent[]): Promise<Agent[]> {
    return this.exclusive(async () => {
      await this.recover();
      // Invalidation may have captured our temporary title while a delivery proof held the lock.
      // Refresh only after that proof has restored the native name.
      agents = (await client.snapshot()).agents;
      const known = new Map(this.links().map((link) => [link.terminalId, link]));
      const candidates = agents.filter(
        (a) => a.agent === 'codex' && (!a.agent_session || known.has(a.terminal_id)),
      );
      const discoveryDue = Date.now() >= this.nextDiscovery;
      let threads: any[] | undefined;
      for (const agent of candidates) {
        const prior = known.get(agent.terminal_id);
        let valid = !!prior?.threadId && titleMatches(agent, prior.name);
        if (valid) valid = (await this.owner(client, agent)) === prior!.process;
        if (valid && Date.now() - prior!.verifiedAt < 30000) continue;
        this.forget(agent.terminal_id);
        if (valid) {
          // Revalidate the already-proven thread directly. Scanning every loaded
          // conversation every 30 seconds stalls interactive sends behind discovery.
          try {
            const link = await this.prove(client, agent, prior!.threadId);
            await client.request('pane.report_agent_session', {
              pane_id: agent.pane_id,
              source: 'herdr:codex',
              agent: 'codex',
              agent_session_id: link.threadId,
            });
            this.save(link);
            this.diagnostic = undefined;
          } catch (error) {
            this.diagnostic = (error as Error).message;
          }
          continue;
        }
        if (!discoveryDue) continue;
        try {
          if (!threads) {
            threads = [];
            let cursor: string | undefined;
            do {
              const loaded = await this.native.request('thread/loaded/list', {
                limit: 100,
                cursor,
              });
              for (let offset = 0; offset < loaded.data.length; offset += 4) {
                const batch = await Promise.all(
                  loaded.data
                    .slice(offset, offset + 4)
                    .map(
                      async (id: string) =>
                        (
                          await this.native.request('thread/read', {
                            threadId: id,
                            includeTurns: false,
                          })
                        ).thread,
                    ),
                );
                for (const thread of batch)
                  if (!thread.parentThreadId && typeof thread.name === 'string')
                    threads.push(thread);
              }
              cursor = loaded.nextCursor ?? undefined;
            } while (cursor && threads.length < 1000);
          }
          for (const thread of threads.filter((t) => titleMatches(agent, t.name))) {
            try {
              const link = await this.prove(client, agent, thread.id);
              await client.request('pane.report_agent_session', {
                pane_id: agent.pane_id,
                source: 'herdr:codex',
                agent: 'codex',
                agent_session_id: thread.id,
              });
              this.save(link);
              this.diagnostic = undefined;
              this.store.audit('system', 'codex.native-link', null, {
                host: this.host,
                terminalId: link.terminalId,
                threadId: link.threadId,
              });
              break;
            } catch (error) {
              this.diagnostic = (error as Error).message;
              /* A name match is never enough; try the next candidate. */
            }
          }
        } catch (error) {
          this.diagnostic = (error as Error).message;
          /* Keep the session unbound when the native daemon is unavailable. */
        }
      }
      if (discoveryDue) this.nextDiscovery = Date.now() + 10000;
      const after = (await client.snapshot()).agents;
      const links = new Map(this.links().map((link) => [link.terminalId, link]));
      return after.map((agent) => {
        const link = links.get(agent.terminal_id);
        return link &&
          (!link.threadId ||
            agent.agent_session?.value !== link.threadId ||
            !titleMatches(agent, link.name))
          ? { ...agent, agent_session: null }
          : agent;
      });
    });
  }
  async assertDelivery(client: HerdrClient, session: Session) {
    return this.exclusive(async () => {
      await this.recover();
      const known = this.links().find((link) => link.terminalId === session.terminalId);
      if (!known) return; // Independently registered native hooks/bridges retain their own binding checks.
      if (known.threadId !== session.nativeSessionId || known.process !== session.processIdentity)
        throw new Error('Codex native binding changed; instruction was not sent');
      const agent = (await client.request('agent.get', { target: session.paneId })).agent;
      try {
        this.save(await this.prove(client, agent, session.nativeSessionId));
      } catch (error) {
        this.forget(session.terminalId);
        throw error;
      }
    });
  }
  hasLink(session: Session) {
    return this.links().some(
      (link) =>
        link.terminalId === session.terminalId &&
        link.threadId === session.nativeSessionId &&
        link.process === session.processIdentity,
    );
  }
  async turnState(client: HerdrClient, session: Session): Promise<Session['status']> {
    if (!this.hasLink(session)) throw new Error('Codex binding is not verified');
    await client.assertBinding(session);
    const result = await this.native.request('thread/turns/list', {
      threadId: session.nativeSessionId,
      limit: 1,
      sortDirection: 'desc',
      itemsView: 'notLoaded',
    });
    if (!Array.isArray(result.data)) throw new Error('Native turn state is unavailable');
    if (!result.data.length) return 'idle';
    if (result.data[0].status === 'inProgress') return 'working';
    if (['completed', 'failed', 'interrupted'].includes(result.data[0].status)) return 'idle';
    throw new Error('Native turn state is unavailable');
  }
  async steer(client: HerdrClient, session: Session, prompt: string) {
    await this.assertDelivery(client, session);
    await client.assertBinding(session);
    const result = await this.native.request('thread/turns/list', {
      threadId: session.nativeSessionId,
      limit: 1,
      sortDirection: 'desc',
      itemsView: 'notLoaded',
    });
    const active = result.data?.find((turn: any) => turn.status === 'inProgress');
    if (!active?.id) throw new Error('The agent is no longer working. Send a new message instead.');
    await this.native.request('turn/steer', {
      threadId: session.nativeSessionId,
      expectedTurnId: active.id,
      clientUserMessageId: randomUUID(),
      input: [{ type: 'text', text: prompt }],
    });
  }
  unavailable(agents: Agent[]): Agent[] {
    const managed = new Set(this.links().map((link) => link.terminalId));
    return agents.map((agent) =>
      managed.has(agent.terminal_id) ? { ...agent, agent_session: null } : agent,
    );
  }
  model(terminalId: string) {
    const link = this.links().find((l) => l.terminalId === terminalId);
    return link?.threadId && link.model
      ? { model: link.model, modelUpdatedAt: new Date(link.verifiedAt).toISOString() }
      : {};
  }
  close() {
    this.native.close?.();
  }
}
