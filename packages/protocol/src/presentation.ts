/** Render an exact native reply envelope as a conversation, without changing stored evidence. */
export function presentUserMessage(text: string): {
  text: string;
  replies?: { question: string; answer: string }[];
} {
  const envelope = text.match(
    /^\s*<send_user_message_question_reply>\s*([\s\S]*?)\s*<\/send_user_message_question_reply>\s*$/,
  );
  if (!envelope) return { text };
  try {
    const values: unknown = JSON.parse(envelope[1]);
    if (!Array.isArray(values) || !values.length || values.length > 32) return { text };
    if (
      !values.every(
        (value) => value && typeof value.question === 'string' && typeof value.answer === 'string',
      )
    )
      return { text };
    const replies = values.map((value) => ({
      question: value.question as string,
      answer: value.answer as string,
    }));
    return { text: replies.map((reply) => reply.answer).join('\n\n'), replies };
  } catch {
    return { text };
  }
}
export function toolLabel(name: string): string {
  const normalized = name.replace(/^functions\./, '');
  const known: Record<string, string> = {
    exec: 'Agent tools',
    exec_command: 'Command',
    write_stdin: 'Command output',
    request_user_input_async: 'Question',
    request_user_input: 'Question',
    apply_patch: 'File changes',
    'web.run': 'Web search',
    web__run: 'Web search',
  };
  return known[normalized] ?? name.replace(/^.*[._]_/, '').replaceAll('_', ' ');
}
