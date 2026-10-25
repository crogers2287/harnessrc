import { open, readFile, readdir, readlink, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Session } from '@harnessrc/protocol';
import type { Store } from '@harnessrc/storage';
import type { ExecWorker } from '../../../packages/adapters/src/subagents.ts';

type Link = { nativeSessionId: string; name: string; pid: string; start: string; log: string };
const nativeId = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

/** Read-only discovery of Codex exec workers carrying their native coordinator's thread ID. */
export class CodexExecWorkers {
  private lastScan = 0;
  private scanning?: Promise<void>;
  constructor(
    private store: Store,
    private localHosts: Set<string>,
    private procRoot = '/proc',
  ) {
    store.db.exec(`CREATE TABLE IF NOT EXISTS codex_exec_workers (
      parent_id TEXT NOT NULL,parent_native_id TEXT NOT NULL,child_native_id TEXT NOT NULL,body TEXT NOT NULL,
      PRIMARY KEY(parent_id,child_native_id))`);
  }
  refresh(): Promise<void> {
    if (this.scanning) return this.scanning;
    if (Date.now() - this.lastScan < 5000 || !this.localHosts.size) return Promise.resolve();
    const work = this.scan().finally(() => {
      this.lastScan = Date.now();
      this.scanning = undefined;
    });
    this.scanning = work;
    return work;
  }
  private async identity(pid: string) {
    const text = await readFile(path.join(this.procRoot, pid, 'stat'), 'utf8');
    const fields = text
      .slice(text.lastIndexOf(')') + 2)
      .trim()
      .split(/\s+/);
    return { start: fields[19], state: fields[0] };
  }
  private async scan() {
    const parents = this.store
      .sessions()
      .filter(
        (s) =>
          s.harness === 'codex' &&
          s.nativeSessionKind === 'id' &&
          this.localHosts.has(s.hostId) &&
          nativeId.test(s.nativeSessionId),
      );
    if (!parents.length) return;
    const processes = await readdir(this.procRoot).catch(() => []);
    for (const pid of processes) {
      if (!/^\d+$/.test(pid)) continue;
      try {
        const dir = path.join(this.procRoot, pid);
        if ((await stat(dir)).uid !== process.getuid?.()) continue;
        const exe = await readlink(path.join(dir, 'exe'));
        if (path.basename(exe) !== 'codex') continue;
        const args = (await readFile(path.join(dir, 'cmdline'))).toString().split('\0');
        const command = args.indexOf('exec');
        if (command < 1 || command > 8) continue;
        const before = await this.identity(pid);
        if (!before.start || ['Z', 'X'].includes(before.state)) continue;
        // Read only the native thread marker; never retain credentials from the environment.
        const marker = (await readFile(path.join(dir, 'environ')))
          .toString()
          .split('\0')
          .find((v) => v.startsWith('CODEX_THREAD_ID='))
          ?.slice('CODEX_THREAD_ID='.length);
        const matching = parents.filter((s) => s.nativeSessionId === marker);
        if (matching.length !== 1) continue;
        const log = await realpath(await readlink(path.join(dir, 'fd/1')));
        if (!(await stat(log)).isFile()) continue;
        const handle = await open(log, 'r');
        let child: string | undefined;
        try {
          const buffer = Buffer.alloc(65536);
          const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
          for (const line of buffer.subarray(0, bytesRead).toString().split('\n')) {
            try {
              const event = JSON.parse(line);
              if (
                event.type === 'thread.started' &&
                typeof event.thread_id === 'string' &&
                nativeId.test(event.thread_id)
              ) {
                child = event.thread_id;
                break;
              }
            } catch {
              /* Ignore a partial or non-JSON startup line. */
            }
          }
        } finally {
          await handle.close();
        }
        if (!child || child === marker || (await this.identity(pid)).start !== before.start)
          continue;
        const parent = matching[0];
        const link: Link = {
          nativeSessionId: child,
          name: path.basename(log, path.extname(log)).slice(0, 80),
          pid,
          start: before.start,
          log,
        };
        this.store.db
          .prepare(
            `INSERT INTO codex_exec_workers VALUES(?,?,?,?)
          ON CONFLICT(parent_id,child_native_id) DO UPDATE SET parent_native_id=excluded.parent_native_id,body=excluded.body`,
          )
          .run(parent.id, parent.nativeSessionId, child, JSON.stringify(link));
      } catch {
        /* Process exit, private descriptors and non-JSON workers are normal discovery misses. */
      }
    }
  }
  async list(parent: Session): Promise<ExecWorker[]> {
    if (!this.localHosts.has(parent.hostId) || parent.harness !== 'codex') return [];
    await this.refresh();
    const rows = this.store.db
      .prepare('SELECT body FROM codex_exec_workers WHERE parent_id=? AND parent_native_id=?')
      .all(parent.id, parent.nativeSessionId);
    return Promise.all(
      rows.map(async (row) => {
        const link: Link = JSON.parse(String(row.body));
        let status: string | undefined;
        try {
          const current = await this.identity(link.pid);
          if (current.start !== link.start || ['Z', 'X'].includes(current.state)) status = 'ended';
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') status = 'ended';
        }
        return {
          nativeSessionId: link.nativeSessionId,
          name: link.name,
          ...(status ? { status } : {}),
        };
      }),
    );
  }
}
