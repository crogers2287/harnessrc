import { open, realpath } from 'node:fs/promises';
import { nativeModel } from './transcripts.ts';

type Lifecycle = { status: string; at: number };
type Summary = {
  inode: number;
  offset: number;
  modified: number;
  partial: Buffer;
  skipping: boolean;
  model?: string;
  status: string;
  at: number;
  ended: Map<string, Lifecycle>;
};

/** Incremental summaries of native records; never retain message text or infer liveness from age. */
export class SubagentMetadata {
  private summaries = new Map<string, Summary>();
  private reading = new Map<string, Promise<Summary>>();
  read(file: string, harness: string): Promise<Summary> {
    const active = this.reading.get(file);
    if (active) return active;
    const work = this.scan(file, harness).finally(() => this.reading.delete(file));
    this.reading.set(file, work);
    return work;
  }
  private async scan(file: string, harness: string): Promise<Summary> {
    if ((await realpath(file)) !== file) throw new Error('Subagent transcript became a symlink');
    const handle = await open(file, 'r');
    try {
      const info = await handle.stat();
      let summary = this.summaries.get(file);
      if (
        !summary ||
        summary.inode !== info.ino ||
        info.size < summary.offset ||
        (info.size === summary.offset && info.mtimeMs !== summary.modified)
      ) {
        summary = {
          inode: info.ino,
          offset: 0,
          modified: info.mtimeMs,
          partial: Buffer.alloc(0),
          skipping: false,
          status: 'observed',
          at: 0,
          ended: new Map(),
        };
        if (this.summaries.size >= 512) this.summaries.delete(this.summaries.keys().next().value!);
        this.summaries.set(file, summary);
      }
      const buffer = Buffer.alloc(Math.min(512 * 1024, info.size - summary.offset));
      while (summary.offset < info.size) {
        const { bytesRead } = await handle.read(
          buffer,
          0,
          Math.min(buffer.length, info.size - summary.offset),
          summary.offset,
        );
        if (!bytesRead) break;
        summary.offset += bytesRead;
        let chunk = buffer.subarray(0, bytesRead);
        if (summary.skipping) {
          const newline = chunk.indexOf(10);
          if (newline < 0) continue;
          summary.skipping = false;
          chunk = chunk.subarray(newline + 1);
        }
        const combined = Buffer.concat([summary.partial, chunk]);
        let start = 0,
          newline: number;
        while ((newline = combined.indexOf(10, start)) >= 0) {
          if (newline - start <= 4 * 1024 * 1024) {
            try {
              this.record(
                summary,
                JSON.parse(combined.subarray(start, newline).toString('utf8')),
                harness,
              );
            } catch {
              /* A damaged record must not hide later model/lifecycle records. */
            }
          }
          start = newline + 1;
        }
        summary.partial = Buffer.from(combined.subarray(start));
        if (summary.partial.length > 4 * 1024 * 1024) {
          summary.partial = Buffer.alloc(0);
          summary.skipping = true;
        }
      }
      summary.modified = info.mtimeMs;
      return summary;
    } finally {
      await handle.close();
    }
  }
  private record(summary: Summary, record: any, harness: string) {
    const at = Date.parse(record.timestamp);
    const status = (value: string) => {
      summary.status = value;
      summary.at = Number.isFinite(at) ? at : summary.at;
    };
    if (harness === 'claude') {
      if (record.type === 'api-request') {
        summary.model = nativeModel(record.params?.model) ?? summary.model;
        status('working');
      } else if (record.type === 'assistant' && !record.isMeta) {
        summary.model = nativeModel(record.message?.model) ?? summary.model;
        status(record.message?.stop_reason === 'end_turn' ? 'idle' : 'working');
      } else if (record.type === 'user' && !record.isMeta) status('working');
      else if (record.type === 'system' && record.subtype === 'turn_duration') status('idle');
      // Native task notifications identify completed child runtimes by their exact agent ID.
      if (
        record.type === 'queue-operation' &&
        record.operation === 'enqueue' &&
        typeof record.content === 'string' &&
        Number.isFinite(at)
      ) {
        for (const notification of record.content.matchAll(
          /<task-notification>([\s\S]*?)<\/task-notification>/g,
        )) {
          const id = /<task-id>([a-zA-Z0-9_-]{1,160})<\/task-id>/.exec(notification[1])?.[1];
          const state = /<status>(completed|failed|killed|stopped)<\/status>/.exec(
            notification[1],
          )?.[1];
          if (id && state) {
            if (summary.ended.size >= 1024)
              summary.ended.delete(summary.ended.keys().next().value!);
            summary.ended.set(id, { status: 'ended', at });
          }
        }
      }
    } else if (harness === 'codex') {
      if (record.type === 'turn_context')
        summary.model = nativeModel(record.payload?.model) ?? summary.model;
      if (record.type === 'event_msg') {
        if (record.payload?.type === 'task_started') status('working');
        else if (['task_complete', 'turn_aborted'].includes(record.payload?.type)) status('idle');
      }
    }
  }
}
