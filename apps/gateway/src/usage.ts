import type { Store } from '@harnessrc/storage';
import { z } from 'zod';
const counter = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const usageSchema = z
  .object({
    scope: z.enum(['session', 'request']),
    requestId: z.string().optional(),
    input: counter.optional(),
    output: counter.optional(),
    total: counter,
    contextUsed: counter.optional(),
    contextWindow: counter.optional(),
  })
  .refine((u) => u.scope !== 'request' || (u.input !== undefined && u.output !== undefined));
export function sessionUsage(store: Store, id: string) {
  const rows = store.db
    .prepare(
      `SELECT body FROM events WHERE session_id=?
    AND json_extract(body,'$.kind')='progress' AND json_type(body,'$.data.usage')='object'
    ORDER BY sequence DESC LIMIT 10000`,
    )
    .all(id)
    .flatMap((row) => {
      const event = JSON.parse(String(row.body));
      const usage = usageSchema.safeParse(event.data.usage);
      return usage.success ? [{ ...event, usage: usage.data }] : [];
    });
  if (!rows.length)
    return { supported: false, reason: 'This harness has not reported token usage yet.' };
  const latest = rows[0];
  const usage = latest.usage;
  if (usage.scope === 'session') return { supported: true, ...usage, updatedAt: latest.timestamp };
  const seen = new Set<string>();
  let input = 0,
    output = 0;
  for (const event of rows) {
    const u = event.usage;
    if (u.scope !== 'request' || u.input === undefined || u.output === undefined) continue;
    const key = u.requestId || event.sourceId;
    if (seen.has(key)) continue;
    seen.add(key);
    input += u.input;
    output += u.output;
  }
  return {
    supported: true,
    input,
    output,
    total: input + output,
    contextUsed: usage.contextUsed,
    contextWindow: usage.contextWindow,
    updatedAt: latest.timestamp,
    partial: rows.length === 10000,
  };
}
