/** Normalize reported native counters only; never estimate tokens from text. */
const count = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : undefined;
/** The installed Zcode session projection reports authoritative totals/context. */
export function zcodeUsage(projection: any) {
  const total = count(projection?.totalTokenCount);
  if (total === undefined) return;
  return {
    scope: 'session',
    total,
    contextUsed: count(projection.contextUsed),
    contextWindow: count(projection.contextWindow),
  };
}
export function codexUsage(info: any) {
  if (!info?.total_token_usage) return;
  const cumulative = info.total_token_usage,
    last = info.last_token_usage;
  const input = count(cumulative.input_tokens),
    output = count(cumulative.output_tokens);
  const total = count(cumulative.total_tokens);
  if (input === undefined || output === undefined || total === undefined) return;
  return {
    scope: 'session',
    input,
    output,
    total,
    contextUsed: count(last?.total_tokens),
    contextWindow: count(info.model_context_window),
  };
}
export function claudeUsage(message: any) {
  const u = message?.usage;
  if (!u) return;
  const uncached = count(u.input_tokens),
    output = count(u.output_tokens);
  if (uncached === undefined || output === undefined) return;
  const input =
    uncached +
    (count(u.cache_read_input_tokens) ?? 0) +
    (count(u.cache_creation_input_tokens) ?? 0);
  return {
    scope: 'request',
    requestId: message.id,
    input,
    output,
    total: input + output,
    contextUsed: input + output,
  };
}

/** DSH TokenUsage fields are disjoint uncached/cache input counters. */
export function dshUsage(u: any, requestId: string) {
  const uncached = count(u?.inputTokens),
    output = count(u?.outputTokens);
  if (uncached === undefined || output === undefined) return;
  const input = uncached + (count(u.cacheReadTokens) ?? 0) + (count(u.cacheWriteTokens) ?? 0);
  return {
    scope: 'request',
    requestId,
    input,
    output,
    total: count(u.totalTokens) ?? input + output,
    contextUsed: input + output,
  };
}
