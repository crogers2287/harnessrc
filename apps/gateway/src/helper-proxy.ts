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
