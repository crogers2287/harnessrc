import type { Event } from './index.ts';

/** Native invocation IDs keep parallel tool results from closing the wrong activity. */
export function activeToolCalls(events: Event[]): Event[] {
  const active: Event[] = [];
  const identity = (event: Event) =>
    event.data.toolCallId ?? event.data.toolId ?? event.data.callId;
  for (const event of events) {
    if (['turn.started', 'turn.completed', 'turn.failed'].includes(event.kind)) active.length = 0;
    else if (event.kind === 'tool.invocation') active.push(event);
    else if (['tool.output', 'tool.completion'].includes(event.kind)) {
      const id = identity(event);
      let index = id === undefined ? -1 : active.findIndex((e) => identity(e) === id);
      // Older adapters omitted invocation IDs. Only one unidentified call is unambiguous.
      if (index < 0 && active.length === 1 && identity(active[0]) === undefined) index = 0;
      if (index >= 0) active.splice(index, 1);
    }
  }
  return active;
}

export function toolCommand(event: Event): string {
  let input = event.data.input;
  if (typeof input === 'string') {
    const raw = input;
    try {
      input = JSON.parse(input);
    } catch {
      return raw;
    }
  }
  if (input && typeof input === 'object') {
    const value = input as Record<string, unknown>;
    return (
      ([value.command, value.cmd, value.description].find(
        (v) => typeof v === 'string',
      ) as string) ?? ''
    );
  }
  return '';
}
