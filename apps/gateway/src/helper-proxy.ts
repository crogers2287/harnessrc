import { setTimeout as sleep } from 'node:timers/promises';

const transientConnections = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'EPIPE',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EAI_AGAIN',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
]);
const connectionFailure = (error: unknown) => {
  const value = error as { message?: string; cause?: { code?: string }; code?: string };
  return (
    transientConnections.has(value?.cause?.code ?? value?.code ?? '') ||
    value?.message === 'fetch failed'
  );
};
export function helperFailureMessage(error: unknown): string {
  if (connectionFailure(error))
    return 'The model proxy connection failed. Your message is saved. Send “continue” when the proxy is available again. Completed session actions remain applied.';
  if ((error as Error)?.name === 'TimeoutError')
    return 'The model proxy timed out. Your message is saved. Send “continue” to resume; completed session actions remain applied.';
  return error instanceof Error
    ? error.message
    : 'The helper request failed. Your conversation is saved.';
}

/** Retry only transport failures before a response is received, never tools or response streams. */
export async function helperProxyRequest(
  fetcher: (url: string, init?: RequestInit) => Promise<Response>,
  url: string,
  init: RequestInit,
) {
  const delays = [250, 1000, 2000];
  for (let attempt = 0; ; attempt++) {
    init.signal?.throwIfAborted();
    try {
      return await fetcher(url, init);
    } catch (error) {
      init.signal?.throwIfAborted();
      if (!connectionFailure(error) || attempt >= delays.length) throw error;
      await sleep(delays[attempt], undefined, { signal: init.signal ?? undefined });
    }
  }
}

/** Bounded OpenAI-compatible response reader; forwards only assistant text. */
export async function helperCompletion(response: Response, onText: (text: string) => void) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Proxy returned an empty response');
  const stream = response.headers.get('content-type')?.includes('text/event-stream');
  const decoder = new TextDecoder();
  let buffer = '',
    size = 0,
    content = '',
    finished = false;
  let usage: any;
  const calls: any[] = [];
  const consume = (frame: string) => {
    const data = frame
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trimStart())
      .join('\n');
    if (!data) return;
    if (data === '[DONE]') {
      finished = true;
      return;
    }
    const body = JSON.parse(data);
    if (body.error) throw new Error('Proxy reported a stream error');
    if (body.usage) usage = body.usage;
    const choice = body.choices?.[0];
    if (choice?.finish_reason) finished = true;
    const delta = choice?.delta;
    if (typeof delta?.content === 'string') {
      content += delta.content;
      onText(content);
    }
    for (const part of delta?.tool_calls ?? []) {
      if (!Number.isInteger(part.index) || part.index < 0 || part.index > 31)
        throw new Error('Unsupported tool call index');
      const call = (calls[part.index] ??= {
        id: '',
        type: 'function',
        function: { name: '', arguments: '' },
      });
      if (part.id) call.id = part.id;
      if (part.function?.name) call.function.name += part.function.name;
      if (part.function?.arguments) call.function.arguments += part.function.arguments;
    }
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 4 * 1024 * 1024) throw new Error('Proxy response exceeded the helper limit');
      buffer += decoder.decode(value, { stream: true });
      if (stream) {
        buffer = buffer.replace(/\r\n/g, '\n');
        let end: number;
        while ((end = buffer.indexOf('\n\n')) >= 0) {
          consume(buffer.slice(0, end));
          buffer = buffer.slice(end + 2);
        }
      }
    }
    buffer += decoder.decode();
    if (!stream) return JSON.parse(buffer);
    if (buffer.trim()) consume(buffer);
    if (!finished)
      throw new Error('Proxy stream disconnected before completion. No actions were retried.');
    return {
      choices: [
        {
          message: {
            role: 'assistant',
            content: content || null,
            ...(calls.length ? { tool_calls: calls.filter(Boolean) } : {}),
          },
        },
      ],
      usage,
    };
  } finally {
    await reader.cancel();
  }
}
