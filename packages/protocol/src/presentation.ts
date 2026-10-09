/** Render an exact native reply envelope as a conversation, without changing stored evidence. */
export type MessagePresentation = {
  text: string;
  replies?: { question: string; answer: string }[];
  command?: string;
  activity?: { title: string; summary: string; details: { label: string; value: string }[] };
};
export function presentUserMessage(text: string): MessagePresentation {
  const command = text.match(
    /^\s*<command-name>([^<>]+)<\/command-name>\s*<command-message>[^<>]*<\/command-message>\s*(?:<command-args>([\s\S]*?)<\/command-args>\s*)?$/,
  );
  if (command && /^\/[\w:-]+$/.test(command[1].trim()))
    return { text: command[2]?.trim() ?? '', command: command[1].trim() };
  const result = text.match(
    /^\s*<local-command-(stdout|stderr)>([\s\S]*?)<\/local-command-\1>\s*$/,
  );
  if (result)
    return {
      text: result[2].trim(),
      activity: {
        title: result[1] === 'stderr' ? 'Command error' : 'Command result',
        summary: result[2].trim() || 'No output',
        details: [],
      },
    };
  const notification = text.match(
    /^\s*<task-notification>([\s\S]*?)<\/task-notification>\s*(?:<system-reminder>([\s\S]*?)<\/system-reminder>\s*)?$/,
  );
  if (notification) {
    const fields: Record<string, string> = {};
    let valid = true;
    const body = notification[1].replace(
      /<(usage|diagnostics)>([\s\S]*?)<\/\1>/g,
      (_, key: string, value: string) => {
        fields[key] = value
          .replace(/<\/[^>]+>/g, '; ')
          .replace(/<([^>]+)>/g, '$1: ')
          .trim();
        return '';
      },
    );
    const rest = body.replace(
      /<(task-id|tool-use-id|output-file|status|summary|task-type)>([\s\S]*?)<\/\1>/g,
      (_, key: string, value: string) => {
        if (key in fields) valid = false;
        fields[key] = value.trim();
        return '';
      },
    );
    if (valid && !rest.trim() && fields.summary) {
      const titles: Record<string, string> = {
        completed: 'Background task completed',
        failed: 'Background task failed',
        killed: 'Background task stopped',
      };
      const labels: Record<string, string> = {
        'task-id': 'Task',
        'tool-use-id': 'Tool call',
        'output-file': 'Output file',
        'task-type': 'Task type',
        status: 'Status',
        usage: 'Usage',
        diagnostics: 'Diagnostics',
      };
      return {
        text: fields.summary,
        activity: {
          title: titles[fields.status] ?? 'Background task update',
          summary: fields.summary,
          details: [
            ...Object.entries(fields)
              .filter(([key]) => key !== 'summary')
              .map(([key, value]) => ({ label: labels[key], value })),
            ...(notification[2] ? [{ label: 'Context', value: notification[2].trim() }] : []),
          ],
        },
      };
    }
  }

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
