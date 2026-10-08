import { createHash } from 'node:crypto';
import { readdir, realpath, stat, open } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { capabilities, type Adapter, type Session, type SourceEvent } from '@harnessrc/protocol';
export function textContent(content: any): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((x) => x.type === 'text' || x.type === 'input_text' || x.type === 'output_text')
    .map((x) => x.text ?? '')
    .join('\n');
}
function source(
  record: any,
  sourceId: string,
  kind: SourceEvent['kind'],
  data: Record<string, unknown>,
): SourceEvent {
  return {
    sourceId,
    kind,
    data,
    timestamp: typeof record.timestamp === 'string' ? record.timestamp : new Date(0).toISOString(),
    raw: record,
  };
}
export function normalizeClaude(record: any): SourceEvent[] {
  const id = record.uuid;
  if (!id || !['user', 'assistant'].includes(record.type)) return [];
  const content = record.message?.content;
  const events: SourceEvent[] = [];
  if (typeof content === 'string')
    return [
      source(record, id, record.type === 'user' ? 'user.message' : 'assistant.message', {
        text: content,
      }),
    ];
  for (const [index, block] of (Array.isArray(content) ? content : []).entries()) {
    const key = `${id}:${index}`;
    if (block.type === 'text')
      events.push(
        source(record, key, record.type === 'user' ? 'user.message' : 'assistant.message', {
          text: block.text,
        }),
      );
    if (block.type === 'tool_use')
      events.push(
        source(record, key, 'tool.invocation', {
          tool: block.name,
          toolId: block.id,
          input: block.input,
        }),
      );
    if (block.type === 'tool_result')
      events.push(
        source(record, key, 'tool.output', {
          toolId: block.tool_use_id,
          text: textContent(block.content) || JSON.stringify(block.content),
          error: block.is_error ?? false,
        }),
      ); /* Private thinking is deliberately not promoted to a reasoning summary. */
  }
  return events;
}
export function normalizeCodex(record: any, index: number): SourceEvent[] {
  const p = record.payload ?? {};
  const prefix =
    record.id ??
    `rollout:${index}:${createHash('sha256').update(JSON.stringify(record)).digest('hex').slice(0, 16)}`;
  if (record.type === 'response_item') {
    if (p.type === 'message' && ['user', 'assistant'].includes(p.role))
      return [
        source(record, p.id ?? prefix, p.role === 'user' ? 'user.message' : 'assistant.message', {
          text: textContent(p.content),
        }),
      ];
    if (p.type === 'function_call' || p.type === 'custom_tool_call')
      return [
        source(record, p.id ?? prefix, 'tool.invocation', {
          tool: p.name,
          toolId: p.call_id,
          input: p.arguments ?? p.input,
        }),
      ];
    if (p.type === 'function_call_output' || p.type === 'custom_tool_call_output')
      return [source(record, p.id ?? prefix, 'tool.output', { toolId: p.call_id, text: p.output })];
    if (p.type === 'reasoning' && Array.isArray(p.summary) && p.summary.length)
      return [
        source(record, p.id ?? prefix, 'reasoning.summary', {
          text: p.summary.map((s: any) => s.text ?? '').join('\n'),
        }),
      ];
  }
  if (record.type === 'event_msg') {
    if (p.type === 'task_started')
      return [source(record, prefix, 'turn.started', { turnId: p.turn_id })];
    if (p.type === 'task_complete')
      return [
        source(record, prefix, 'turn.completed', { turnId: p.turn_id }),
      ]; /* event_msg user_message/agent_message duplicate canonical response_item messages. */
  }
  return [];
}
export function normalizeOmp(record: any): SourceEvent[] {
  if (record.type !== 'message' || !record.id) return [];
  const m = record.message ?? {};
  if (m.role === 'toolResult')
    return [
      source(record, record.id, 'tool.output', {
        toolId: m.toolCallId,
        text: textContent(m.content),
        error: m.isError,
      }),
    ];
  if (!['user', 'assistant'].includes(m.role)) return [];
  const events: SourceEvent[] = [];
  const text = textContent(m.content);
  if (text)
    events.push(
      source(record, record.id, m.role === 'user' ? 'user.message' : 'assistant.message', {
        text,
        parentId: record.parentId,
        branch: true,
      }),
    );
  for (const [i, c] of (Array.isArray(m.content) ? m.content : []).entries())
    if (c.type === 'toolCall')
      events.push(
        source(record, `${record.id}:tool:${i}`, 'tool.invocation', {
          tool: c.name,
          toolId: c.id,
          input: c.arguments,
          parentId: record.parentId,
        }),
      );
  return events;
}
async function files(root: string, depth = 0): Promise<string[]> {
  if (depth > 5) return [];
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const e of entries) {
    if (e.isSymbolicLink()) continue;
    const p = path.join(root, e.name);
    if (e.isDirectory()) out.push(...(await files(p, depth + 1)));
    else if (e.name.endsWith('.jsonl')) out.push(p);
    if (out.length > 20000) throw new Error('Transcript directory limit exceeded');
  }
  return out;
}
export async function resolveTranscript(session: Session, root: string): Promise<string> {
  const canonicalRoot = await realpath(root);
  let matches: string[];
  if (session.nativeSessionKind === 'path') matches = [session.nativeSessionId];
  else {
    if (!/^[a-zA-Z0-9_-]{1,160}$/.test(session.nativeSessionId))
      throw new Error('Invalid native session id');
    matches = (await files(canonicalRoot)).filter((p) =>
      session.harness === 'codex'
        ? path.basename(p).endsWith(`-${session.nativeSessionId}.jsonl`)
        : session.harness === 'omp'
          ? path.basename(p).endsWith(`_${session.nativeSessionId}.jsonl`)
          : path.basename(p) === `${session.nativeSessionId}.jsonl`,
    );
  }
  if (matches.length !== 1)
    throw new Error(`Expected exactly one transcript; found ${matches.length}`);
  const canonical = await realpath(matches[0]);
  if (!canonical.startsWith(canonicalRoot + path.sep))
    throw new Error('Transcript is outside configured root');
  return canonical;
}
export class JsonlAdapter implements Adapter {
  capabilities = capabilities(['readConversation', 'streamConversation']);
  private cursors = new Map<
    string,
    { file: string; inode: number; offset: number; index: number; partial: string }
  >();
  constructor(
    private root: string,
    private harness: 'claude' | 'codex' | 'omp',
  ) {}
  async read(session: Session): Promise<SourceEvent[]> {
    const file = await resolveTranscript(session, this.root);
    const s = await stat(file);
    let c = this.cursors.get(session.id);
    if (!c || c.file !== file || c.inode !== s.ino || s.size < c.offset)
      c = { file, inode: s.ino, offset: 0, index: 0, partial: '' };
    if (s.size - c.offset > 128 * 1024 * 1024)
      throw new Error('Transcript exceeds 128 MiB import limit');
    const handle = await open(file, 'r');
    try {
      const size = Math.min(s.size - c.offset, 4 * 1024 * 1024);
      const buffer = Buffer.alloc(size);
      const { bytesRead } = await handle.read(buffer, 0, size, c.offset);
      c.offset += bytesRead;
      /* Buffer remainder avoids splitting UTF-8 across read boundaries. */ const combined =
        Buffer.concat([Buffer.from(c.partial, 'base64'), buffer.subarray(0, bytesRead)]);
      const last = combined.lastIndexOf(10);
      if (last < 0) {
        c.partial = combined.toString('base64');
        this.cursors.set(session.id, c);
        if (combined.length > 4 * 1024 * 1024) throw new Error('Transcript record exceeds limit');
        return [];
      }
      c.partial = combined.subarray(last + 1).toString('base64');
      const events: SourceEvent[] = [];
      for (const line of combined.subarray(0, last).toString('utf8').split('\n')) {
        const index = c.index++;
        if (!line.trim()) continue;
        let record;
        try {
          record = JSON.parse(line);
        } catch {
          throw new Error(`Invalid complete JSONL record at ${index}`);
        }
        events.push(
          ...(this.harness === 'claude'
            ? normalizeClaude(record)
            : this.harness === 'codex'
              ? normalizeCodex(record, index)
              : normalizeOmp(record)),
        );
      }
      this.cursors.set(session.id, c);
      return events;
    } finally {
      await handle.close();
    }
  }
}
export class HermesAdapter implements Adapter {
  capabilities = capabilities(['readConversation', 'streamConversation']);
  constructor(private file: string) {}
  async read(session: Session): Promise<SourceEvent[]> {
    const db = new DatabaseSync(this.file, { readOnly: true });
    try {
      const columns = db
        .prepare('PRAGMA table_info(messages)')
        .all()
        .map((r) => r.name);
      for (const required of ['id', 'session_id', 'role', 'content', 'timestamp'])
        if (!columns.includes(required)) throw new Error('Unsupported Hermes schema');
      return db
        .prepare('SELECT id,role,content,timestamp FROM messages WHERE session_id=? ORDER BY id')
        .all(session.nativeSessionId)
        .flatMap((r: any) =>
          ['user', 'assistant', 'tool'].includes(r.role)
            ? [
                {
                  sourceId: `hermes:${r.id}`,
                  kind:
                    r.role === 'tool'
                      ? 'tool.output'
                      : r.role === 'user'
                        ? 'user.message'
                        : 'assistant.message',
                  timestamp: new Date(Number(r.timestamp) * 1000).toISOString(),
                  data: { text: r.content ?? '' },
                } as SourceEvent,
              ]
            : [],
        );
    } finally {
      db.close();
    }
  }
}
export class OpenCodeAdapter implements Adapter {
  capabilities = capabilities(['readConversation', 'streamConversation']);
  constructor(
    private endpoint: string,
    private auth?: string,
  ) {}
  async read(session: Session): Promise<SourceEvent[]> {
    const url = new URL(
      `/session/${encodeURIComponent(session.nativeSessionId)}/message`,
      this.endpoint,
    );
    const response = await fetch(url, {
      headers: this.auth ? { Authorization: this.auth } : {},
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`OpenCode returned ${response.status}`);
    const messages = (await response.json()) as any[];
    return messages.flatMap((m) =>
      (m.parts ?? []).flatMap((p: any) =>
        p.type === 'text'
          ? [
              {
                sourceId: `opencode:${m.info.id}:${p.id}`,
                kind: m.info.role === 'user' ? 'user.message' : 'assistant.message',
                timestamp: new Date(m.info.time.created).toISOString(),
                data: { text: p.text },
              } as SourceEvent,
            ]
          : p.type === 'tool'
            ? [
                {
                  sourceId: `opencode:${m.info.id}:${p.id}:${p.state.status}`,
                  kind: p.state.status === 'completed' ? 'tool.completion' : 'tool.invocation',
                  timestamp: new Date(m.info.time.created).toISOString(),
                  data: { tool: p.tool, input: p.state.input, output: p.state.output },
                } as SourceEvent,
              ]
            : [],
      ),
    );
  }
}
