import { open, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { redact, type Event, type Session } from '@harnessrc/protocol';
import { JsonlAdapter, resolveTranscript } from './transcripts.ts';

export type Subagent = {
  id: string;
  nativeSessionId: string;
  name: string;
  model?: string;
  updatedAt: string;
  status: string;
};
type Entry = Subagent & { file: string };
/** Native parent linkage only: never infer children from names, CWD or model text. */
export class SubagentReader {
  private catalogs = new Map<string, { at: number; entries: Entry[] }>();
  private metadata = new Map<string, { modified: number; records: any[] }>();
  private histories = new Map<string, { adapter: JsonlAdapter; events: Event[] }>();
  constructor(private roots: { claude: string; codex: string }) {}
  supported(s: Session) {
    return ['claude', 'codex'].includes(s.harness) && s.nativeSessionKind === 'id';
  }
  async list(s: Session): Promise<Subagent[]> {
    return (await this.entries(s)).map(({ file: _file, ...entry }) => ({
      ...entry,
      name: String(redact(entry.name)),
    }));
  }
  private async entries(s: Session): Promise<Entry[]> {
    if (!this.supported(s)) return [];
    const key = `${s.hostId}:${s.harness}:${s.nativeSessionId}`;
    const cached = this.catalogs.get(key);
    if (cached && Date.now() - cached.at < 60000) return cached.entries;
    const root = await realpath(this.roots[s.harness as 'claude' | 'codex']);
    const candidates: string[] = [];
    if (s.harness === 'claude') {
      const parent = await resolveTranscript(s, root);
      const dir = path.join(path.dirname(parent), s.nativeSessionId, 'subagents');
      const canonicalDir = await realpath(dir).catch((e) => {
        if (e.code === 'ENOENT') return undefined;
        throw e;
      });
      if (canonicalDir && canonicalDir !== dir)
        throw new Error('Subagent folder must not be a symlink');
      const children = await readdir(dir, { withFileTypes: true }).catch((e) => {
        if (e.code === 'ENOENT') return [];
        throw e;
      });
      for (const child of children)
        if (child.isFile() && /^agent-[\w-]+\.jsonl$/.test(child.name))
          candidates.push(path.join(dir, child.name));
    } else {
      const walk = async (dir: string, depth = 0) => {
        if (depth > 5) return;
        for (const e of await readdir(dir, { withFileTypes: true })) {
          if (e.isSymbolicLink()) continue;
          if (e.isDirectory()) await walk(path.join(dir, e.name), depth + 1);
          else if (e.isFile() && e.name.endsWith('.jsonl')) candidates.push(path.join(dir, e.name));
          if (candidates.length > 20000) throw new Error('Subagent catalog limit exceeded');
        }
      };
      await walk(root);
    }
    const entries: Entry[] = [];
    for (const candidate of candidates) {
      const file = await realpath(candidate);
      if (!file.startsWith(root + path.sep)) continue;
      const info = await stat(file);
      const cachedMeta = this.metadata.get(file);
      let records: any[] = cachedMeta?.records ?? [];
      if (!cachedMeta || cachedMeta.modified !== info.mtimeMs) {
        const h = await open(file, 'r');
        try {
          const buffer = Buffer.alloc(65536);
          const { bytesRead } = await h.read(buffer, 0, buffer.length, 0);
          records = buffer
            .subarray(0, bytesRead)
            .toString('utf8')
            .split('\n')
            .flatMap((line) => {
              try {
                return [JSON.parse(line)];
              } catch {
                return [];
              }
            });
        } finally {
          await h.close();
        }
        records = records
          .filter(
            (r) =>
              r.type === 'session_meta' ||
              r.type === 'turn_context' ||
              (r.type === 'assistant' && r.message?.model),
          )
          .slice(0, 8)
          .map((r) => ({
            type: r.type,
            payload:
              r.type === 'session_meta'
                ? { id: r.payload?.id, source: r.payload?.source }
                : { model: r.payload?.model },
            message: { model: r.message?.model },
          }));
        if (this.metadata.size >= 20000) this.metadata.clear();
        this.metadata.set(file, { modified: info.mtimeMs, records });
      }
      const meta = records.find((r) => r.type === 'session_meta')?.payload;
      const spawn = meta?.source?.subagent?.thread_spawn;
      if (s.harness === 'codex' && spawn?.parent_thread_id !== s.nativeSessionId) continue;
      const nativeSessionId =
        s.harness === 'codex' ? meta.id : path.basename(file, '.jsonl').slice(6);
      if (typeof nativeSessionId !== 'string' || !/^[a-zA-Z0-9_-]{1,160}$/.test(nativeSessionId))
        continue;
      entries.push({
        id: createHash('sha256').update(`${key}:${nativeSessionId}`).digest('hex'),
        nativeSessionId,
        name: String(
          spawn?.agent_path ?? spawn?.agent_nickname ?? `Agent ${nativeSessionId}`,
        ).slice(0, 256),
        model:
          records.find((r) => r.type === 'turn_context')?.payload?.model ??
          records.find((r) => r.type === 'assistant')?.message?.model,
        updatedAt: info.mtime.toISOString(),
        status: 'observed',
        file,
      });
    }
    entries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    this.catalogs.set(key, { at: Date.now(), entries });
    return entries.map((e) => ({ ...e, name: String(redact(e.name)) }));
  }
  async conversation(s: Session, id: string, before: number, limit: number) {
    const entry = (await this.entries(s)).find((e) => e.id === id);
    if (!entry) throw new Error('Subagent does not belong to this session');
    const child: Session = {
      ...s,
      id,
      nativeSessionId: entry.file,
      nativeSessionKind: 'path',
      ownership: 'observed',
      capabilities: { readConversation: true },
    };
    let history = this.histories.get(id);
    if (!history) {
      history = {
        adapter: new JsonlAdapter(
          this.roots[s.harness as 'claude' | 'codex'],
          s.harness as 'claude' | 'codex',
        ),
        events: [],
      };
      if (this.histories.size >= 32) this.histories.delete(this.histories.keys().next().value!);
      this.histories.set(id, history);
    }
    // Chunked native history import. Every source identity survives restart/replay.
    for (let chunk = 0; chunk < 32; chunk++) {
      const incoming = await history.adapter.read(child);
      const seen = new Set(history.events.map((e) => e.sourceId));
      for (const e of incoming)
        if (!seen.has(e.sourceId)) {
          seen.add(e.sourceId);
          if (history.events.length >= 100000)
            throw new Error('Subagent history exceeds the viewer limit');
          history.events.push({
            ...e,
            raw: undefined,
            data: redact(e.data) as Record<string, unknown>,
            id: createHash('sha256').update(`${id}:${e.sourceId}`).digest('hex'),
            sessionId: id,
            nativeSessionId: entry.nativeSessionId,
            source: s.harness,
            sequence: history.events.length + 1,
          });
        }
      if (!incoming.length) break;
    }
    return {
      subagent: await this.list(s).then((list) => list.find((e) => e.id === id)),
      events: history.events.filter((e) => e.sequence < before).slice(-limit),
    };
  }
}
