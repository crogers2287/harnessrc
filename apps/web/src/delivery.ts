import { presentUserMessage, type Event } from '@harnessrc/protocol';
export type Outgoing = {
  key: string;
  nativeRequestId?: string;
  delivery?: 'next-step';
  prompt: string;
  attachments?: { id: string; name: string; mime: string }[];
  started: string;
  state: 'sending' | 'confirmed' | 'uncertain';
};
/** Display-only reconciliation. Never authorizes a retry or native command. */
export function hasNativeEcho(item: Outgoing, events: Event[]): boolean {
  return events.some((e) => {
    if (e.kind !== 'user.message') return false;
    const ids = [item.key, item.nativeRequestId].filter(Boolean);
    if (
      ids.some(
        (id) =>
          e.data.taskId === id ||
          e.data.requestId === id ||
          String(e.data.text ?? '').includes(`[Relay request ${id}]`),
      )
    )
      return true;
    if (Date.parse(e.timestamp) < Date.parse(item.started) - 1000) return false;
    const presentation = presentUserMessage(String(e.data.text ?? ''));
    const echo = presentation.command
      ? `${presentation.command} ${presentation.text}`.trim()
      : String(e.data.text ?? '').trim();
    if (echo !== item.prompt.trim()) return false;
    const expected = (item.attachments ?? []).map((f) => f.id).sort();
    const actual = Array.isArray(e.data.attachments)
      ? e.data.attachments.map((f: any) => f.id).sort()
      : [];
    return JSON.stringify(expected) === JSON.stringify(actual);
  });
}
