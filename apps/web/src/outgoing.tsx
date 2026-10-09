import { useEffect, useState, useRef } from 'react';
import { api } from '@harnessrc/client-sdk';
import { z } from 'zod';
import { SentAttachment } from './attachments.tsx';
import type { Event } from '@harnessrc/protocol';
import { hasNativeEcho, type Outgoing } from './delivery.ts';
export function useOutgoing(sessionId: string, events: Event[]) {
  const [items, setItems] = useState<Outgoing[]>(() => {
    try {
      return z
        .array(
          z.object({
            key: z.string(),
            nativeRequestId: z.string().optional(),
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
  const checked = useRef(new Set<string>());
  useEffect(() => {
    // A stale saved card may refer to history older than the current transcript page.
    for (const item of items) {
      if (
        item.state === 'sending' ||
        checked.current.has(item.key) ||
        !z.uuid().safeParse(item.key).success
      )
        continue;
      checked.current.add(item.key);
      void api(`/api/sessions/${sessionId}/message-receipts/${item.key}`)
        .then((result) => {
          if (result.nativeSeen) setItems((old) => old.filter((x) => x.key !== item.key));
        })
        .catch(() => {
          /* Native events can still reconcile this card after reconnect. */
        });
    }
  }, [items, sessionId]);
  useEffect(() => {
    try {
      sessionStorage.setItem(`relay-outgoing:${sessionId}`, JSON.stringify(items));
    } catch {
      /* optional browser storage */
    }
  }, [items, sessionId]);
  useEffect(() => {
    setItems((old) => {
      const remaining = old.filter((item) => !hasNativeEcho(item, events));
      return remaining.length === old.length ? old : remaining;
    });
  }, [events, items]);
  return {
    items: items.filter((item) => !hasNativeEcho(item, events)),
    begin: (key: string, prompt: string, attachments: Outgoing['attachments'] = []) =>
      setItems((old) => [
        ...old.filter((x) => x.key !== key),
        { key, prompt, attachments, started: new Date().toISOString(), state: 'sending' },
      ]),
    finish: (key: string, state: Outgoing['state'], nativeRequestId?: string) =>
      setItems((old) => old.map((x) => (x.key === key ? { ...x, state, nativeRequestId } : x))),
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
