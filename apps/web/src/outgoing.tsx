import { useEffect, useState } from 'react';
import { z } from 'zod';
import { SentAttachment } from './attachments.tsx';
import type { Event } from '@harnessrc/protocol';
export type Outgoing = {
  key: string;
  prompt: string;
  attachments?: { id: string; name: string; mime: string }[];
  started: string;
  state: 'sending' | 'confirmed' | 'uncertain';
};
export function useOutgoing(sessionId: string, events: Event[]) {
  const [items, setItems] = useState<Outgoing[]>(() => {
    try {
      return z
        .array(
          z.object({
            key: z.string(),
            prompt: z.string(),
            attachments: z
              .array(z.object({ id: z.string(), name: z.string(), mime: z.string() }))
              .optional(),
            started: z.iso.datetime(),
            state: z.enum(['sending', 'confirmed', 'uncertain']),
          }),
        )
        .parse(JSON.parse(sessionStorage.getItem(`relay-outgoing:${sessionId}`) ?? '[]'))
        .map((x: Outgoing) => ({ ...x, state: x.state === 'sending' ? 'uncertain' : x.state }));
    } catch {
      return [];
    }
  });
  useEffect(() => {
    try {
      sessionStorage.setItem(`relay-outgoing:${sessionId}`, JSON.stringify(items));
    } catch {
      /* optional browser storage */
    }
  }, [items, sessionId]);
  useEffect(() => {
    // Only remove the local delivery card when native history contains the submitted text.
    // This is a display reconciliation, never evidence for queue dispatch or interaction routing.
    const echoes = events.filter((e) => e.kind === 'user.message');
    setItems((old) => {
      const remaining = old.filter(
        (item) =>
          !echoes.some(
            (e) =>
              Date.parse(e.timestamp) >= Date.parse(item.started) - 1000 &&
              (e.data.taskId === item.key ||
                String(e.data.text ?? '').includes(`[Relay request ${item.key}]`) ||
                (!item.attachments?.length &&
                  String(e.data.text ?? '').trim() === item.prompt.trim())),
          ),
      );
      return remaining.length === old.length ? old : remaining;
    });
  }, [events]);
  return {
    items,
    begin: (key: string, prompt: string, attachments: Outgoing['attachments'] = []) =>
      setItems((old) => [
        ...old.filter((x) => x.key !== key),
        { key, prompt, attachments, started: new Date().toISOString(), state: 'sending' },
      ]),
    finish: (key: string, state: Outgoing['state']) =>
      setItems((old) => old.map((x) => (x.key === key ? { ...x, state } : x))),
    dismiss: (key: string) => setItems((old) => old.filter((x) => x.key !== key)),
  };
}
export function OutgoingMessages({
  items,
  sessionId,
  restore,
  dismiss,
}: {
  items: Outgoing[];
  sessionId: string;
  restore: (text: string) => void;
  dismiss: (key: string) => void;
}) {
  return (
    <>
      {items.map((item) => (
        <article className="message user-message outgoing-message" key={item.key}>
          <div className="message-author">You</div>
          <div className="message-content">
            <p style={{ whiteSpace: 'pre-wrap' }}>{item.prompt}</p>
          </div>
          {!!item.attachments?.length && (
            <div className="sent-attachments">
              {item.attachments.map((file) => (
                <SentAttachment key={file.id} sessionId={sessionId} file={file} />
              ))}
            </div>
          )}
          <div className="message-actions" role="status">
            {item.state === 'sending'
              ? 'Sending…'
              : item.state === 'confirmed'
                ? 'Sent · waiting for conversation update'
                : 'Delivery not confirmed. Check the conversation before sending again.'}
            {item.state === 'uncertain' && (
              <>
                <button type="button" onClick={() => restore(item.prompt)}>
                  Restore draft
                </button>
                <button type="button" onClick={() => dismiss(item.key)}>
                  Dismiss
                </button>
              </>
            )}
          </div>
        </article>
      ))}
    </>
  );
}
