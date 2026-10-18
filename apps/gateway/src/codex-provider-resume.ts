import { z } from 'zod';
import type { CodexDaemon } from '../../../packages/adapters/src/codex-daemon.ts';

export async function idleDescendants(native: Pick<CodexDaemon, 'request'>, threadId: string) {
  const ids: string[] = [];
  let cursor: string | undefined;
  const cursors = new Set<string>();
  do {
    const result = await native.request('thread/list', {
      ancestorThreadId: threadId,
      archived: false,
      limit: 100,
      ...(cursor ? { cursor } : {}),
    });
    const page = z
      .object({
        data: z.array(z.object({ id: z.uuid(), status: z.object({ type: z.string() }) })),
        nextCursor: z.string().nullable().optional(),
      })
      .parse(result);
    for (const thread of page.data) {
      if (!['idle', 'notLoaded'].includes(thread.status.type))
        throw new Error('Finish or stop active sub-agents before swapping providers');
      ids.push(thread.id);
      if (ids.length > 1000)
        throw new Error('Too many child conversations for a safe provider restart');
    }
    cursor = page.nextCursor ?? undefined;
    if (cursor && cursors.has(cursor)) throw new Error('Invalid descendant cursor');
    if (cursor) cursors.add(cursor);
  } while (cursor);
  return [...new Set(ids)];
}
/** Loaded Codex threads ignore provider overrides. Archive/unarchive releases that runtime,
 * preserves the exact thread ID/history, and restores previously active idle child logs.
 * Never use this for active children or a second CLI owner. */
export async function resumeCodexProvider(
  native: Pick<CodexDaemon, 'request'>,
  threadId: string,
  params: Record<string, unknown>,
  recordManifest?: (ids: string[]) => void,
) {
  const { thread } = await native.request('thread/read', { threadId, includeTurns: false });
  if (thread.id !== threadId || !['idle', 'notLoaded'].includes(thread.status?.type))
    throw new Error('Native Codex is still working; provider restart was not performed');
  const descendants = await idleDescendants(native, threadId);
  recordManifest?.(descendants);
  let archived = false;
  try {
    archived = true;
    await native.request('thread/archive', { threadId });
    const loaded = z
      .object({ data: z.array(z.string()) })
      .parse(await native.request('thread/loaded/list', {}));
    if (loaded.data.includes(threadId)) throw new Error('Old native Codex runtime remains loaded');
    await native.request('thread/unarchive', { threadId });
    archived = false;
    await restoreDescendants(native, threadId, descendants);
    return await native.request('thread/resume', { threadId, ...params });
  } finally {
    // Attempt restoration after a partial native failure, without retrying any CLI launch.
    if (archived)
      try {
        await native.request('thread/unarchive', { threadId });
      } catch {
        /* receipt remains uncertain */
      }
    try {
      await restoreDescendants(native, threadId, descendants);
    } catch {
      /* receipt remains uncertain; native history is retained */
    }
  }
}

async function restoreDescendants(
  native: Pick<CodexDaemon, 'request'>,
  root: string,
  original: string[],
) {
  if (!original.length) return;
  let cursor: string | undefined;
  const archived = new Set<string>();
  const cursors = new Set<string>();
  do {
    const page = z
      .object({
        data: z.array(z.object({ id: z.uuid() })),
        nextCursor: z.string().nullable().optional(),
      })
      .parse(
        await native.request('thread/list', {
          ancestorThreadId: root,
          archived: true,
          limit: 100,
          ...(cursor ? { cursor } : {}),
        }),
      );
    for (const thread of page.data) archived.add(thread.id);
    if (archived.size > 1000) throw new Error('Too many archived descendants for safe restoration');
    cursor = page.nextCursor ?? undefined;
    if (cursor && cursors.has(cursor)) throw new Error('Invalid archived descendant cursor');
    if (cursor) cursors.add(cursor);
  } while (cursor);
  for (const id of original)
    if (archived.has(id)) {
      const result = await native.request('thread/unarchive', { threadId: id });
      if (result.thread?.id !== id) throw new Error('Child conversation restore was not confirmed');
    }
}
