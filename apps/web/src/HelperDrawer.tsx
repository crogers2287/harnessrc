import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@harnessrc/client-sdk';
import { X } from 'lucide-react';

type Profile = {
  id: string;
  label: string;
  provider: string;
  models: { id: string; name: string }[];
  defaultModel?: string;
  connected: boolean;
  allowCustomModel: boolean;
};
type HelperState = {
  attention?: {
    enabled: boolean;
    waitingMinutes: number;
    items: { sessionId: string; interactionId: string; name: string; waitingMinutes: number }[];
  };
  profiles: Profile[];
  current: null | {
    requestId: string;
    profileId: string;
    model: string;
    id: string;
    status: string;
    error?: string;
    messages: { role: string; content: string }[];
    usage?: { total: number };
    receipt: { status: string; diagnostic?: string };
  };
};
export function HelperDrawer({
  open,
  show,
  close,
  openSession,
}: {
  open: boolean;
  show: () => void;
  close: () => void;
  openSession: (sessionId: string, interactionId: string) => void;
}) {
  const panel = useRef<HTMLDialogElement>(null);
  const query = useQueryClient();
  const state = useQuery<HelperState>({
    queryKey: ['helper'],
    queryFn: () => api('/api/helper'),
    enabled: open,
    refetchInterval: open ? 1000 : false,
  });
  const [fresh, setFresh] = useState(false);
  const [attentionOpen, setAttentionOpen] = useState(false);
  const [profileId, setProfileId] = useState('');
  const [model, setModel] = useState('');
  const [prompt, setPrompt] = useState(() => sessionStorage.getItem('relay-helper-prompt') ?? '');
  const [pending, setPending] = useState(
    () => sessionStorage.getItem('relay-helper-pending') ?? '',
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const current = state.data?.current;
  useEffect(() => {
    if (
      !pending ||
      !current ||
      current?.requestId !== JSON.parse(pending).requestId ||
      !['started', 'uncertain'].includes(current.receipt.status)
    )
      return;
    sessionStorage.removeItem('relay-helper-pending');
    setPending('');
    setFresh(false);
  }, [pending, current]);
  const profiles = state.data?.profiles ?? [];
  const profile = profiles.find((p) => p.id === profileId) ?? profiles[0];
  const chosenModel = model || profile?.defaultModel || profile?.models[0]?.id || '';
  useEffect(() => {
    sessionStorage.setItem('relay-helper-prompt', prompt);
  }, [prompt]);
  useEffect(() => {
    if (!open) {
      panel.current?.close();
      return;
    }
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.showModal();
    return () => previous?.focus({ preventScroll: true });
  }, [open]);
  useEffect(() => {
    let start: { x: number; y: number } | undefined;
    const begin = (e: TouchEvent) => {
      if (
        open ||
        e.touches.length !== 1 ||
        e.touches[0].clientX < innerWidth - 40 ||
        (e.target instanceof Element &&
          e.target.closest('button,a,input,textarea,select,[contenteditable=true]'))
      )
        return;
      start = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    };
    const end = (e: TouchEvent) => {
      if (start && e.changedTouches.length) {
        const dx = e.changedTouches[0].clientX - start.x,
          dy = e.changedTouches[0].clientY - start.y;
        if (dx < -55 && Math.abs(dx) > Math.abs(dy) * 1.5) show();
      }
      start = undefined;
    };
    const cancel = () => {
      start = undefined;
    };
    window.addEventListener('touchstart', begin, { passive: true });
    window.addEventListener('touchend', end);
    window.addEventListener('touchcancel', cancel);
    return () => {
      window.removeEventListener('touchstart', begin);
      window.removeEventListener('touchend', end);
      window.removeEventListener('touchcancel', cancel);
    };
  }, [open, show]);
  const recover = async () => {
    setBusy(true);
    setError('');
    try {
      const result = await state.refetch();
      if (result.error) throw result.error;
      if (result.data?.current?.requestId === JSON.parse(pending).requestId) {
        setFresh(false);
        setPending('');
        sessionStorage.removeItem('relay-helper-pending');
      } else {
        setError('No receipt is visible yet. Retry the same request to check delivery.');
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const start = async () => {
    if (!profile) return;
    setBusy(true);
    setError('');
    try {
      const body =
        pending ||
        JSON.stringify({
          requestId: crypto.randomUUID(),
          profileId: profile.id,
          model: chosenModel,
          prompt,
          replace: fresh,
        });
      sessionStorage.setItem('relay-helper-pending', body);
      setPending(body);
      await api('/api/helper', { method: 'POST', body });
      setPending('');
      sessionStorage.removeItem('relay-helper-pending');
      setPrompt('');
      setFresh(false);
      await Promise.all([query.invalidateQueries({ queryKey: ['helper'] })]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <dialog
        ref={panel}
        className="helper-drawer"
        aria-label="Relay helper"
        onCancel={(e) => {
          e.preventDefault();
          close();
        }}
      >
        {open && (
          <>
            <header className="helper-heading">
              <h2 id="helper-title">Relay helper</h2>
              <button
                onClick={() => setAttentionOpen(!attentionOpen)}
                aria-expanded={attentionOpen}
              >
                Waiting ({state.data?.attention?.items.length ?? 0})
              </button>
              {current && !fresh && (
                <button
                  aria-label="New conversation"
                  onClick={() => {
                    setFresh(true);
                  }}
                >
                  New chat
                </button>
              )}
              <button aria-label="Close helper" onClick={close}>
                <X size={22} />
              </button>
            </header>
            {attentionOpen ? (
              <div className="helper-setup">
                <h3>Sessions needing input</h3>
                <p>
                  {state.data?.attention?.enabled
                    ? `One reminder after ${state.data.attention.waitingMinutes} minutes of waiting.`
                    : 'Background reminders are disabled on this gateway.'}{' '}
                  Enable notifications in Settings to receive alerts.
                </p>
                {!state.data?.attention?.items.length && (
                  <p>No sessions are waiting for an answer.</p>
                )}
                {state.data?.attention?.items.map((item) => (
                  <button
                    key={item.interactionId}
                    onClick={() => openSession(item.sessionId, item.interactionId)}
                  >
                    {item.name} · waiting {item.waitingMinutes} min
                  </button>
                ))}
                <button onClick={() => setAttentionOpen(false)}>Back to helper</button>
              </div>
            ) : current && !fresh ? (
              <PrivateHelperChat current={current} refresh={() => void state.refetch()} />
            ) : (
              <form
                className="helper-setup"
                onSubmit={(e) => {
                  e.preventDefault();
                  void start();
                }}
              >
                <p>
                  Ask about your sessions, check what needs attention, or manage your running
                  agents.
                </p>
                {state.isPending ? (
                  <p role="status">Loading connections…</p>
                ) : !profiles.length ? (
                  <p>
                    Configure a helper connection on the gateway with your proxy URL and models. No
                    host or model is built into the app.
                  </p>
                ) : (
                  <>
                    <label>
                      Connection
                      <select
                        value={profile?.id ?? ''}
                        disabled={busy || !!pending}
                        onChange={(e) => {
                          setProfileId(e.target.value);
                          setModel('');
                        }}
                      >
                        {profiles.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.label} · {p.provider}
                            {p.connected ? '' : ' (offline)'}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Model
                      <select
                        value={chosenModel}
                        disabled={busy || !!pending}
                        onChange={(e) => setModel(e.target.value)}
                      >
                        {profile?.models.map((m) => (
                          <option value={m.id} key={m.id}>
                            {m.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    {profile?.allowCustomModel && (
                      <label>
                        Model ID
                        <input
                          value={chosenModel}
                          disabled={busy || !!pending}
                          onChange={(e) => setModel(e.target.value)}
                        />
                      </label>
                    )}
                    <label>
                      Message
                      <textarea
                        value={prompt}
                        rows={3}
                        disabled={busy || !!pending}
                        onChange={(e) => setPrompt(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && e.ctrlKey && !e.nativeEvent.isComposing) {
                            e.preventDefault();
                            const field = e.currentTarget;
                            const start = field.selectionStart,
                              end = field.selectionEnd;
                            setPrompt(prompt.slice(0, start) + '\n' + prompt.slice(end));
                            requestAnimationFrame(() =>
                              field.setSelectionRange(start + 1, start + 1),
                            );
                            return;
                          }
                          if (
                            e.key === 'Enter' &&
                            !e.ctrlKey &&
                            !e.shiftKey &&
                            !e.nativeEvent.isComposing
                          ) {
                            e.preventDefault();
                            if (
                              !busy &&
                              prompt.trim() &&
                              chosenModel &&
                              profile?.connected &&
                              !pending
                            )
                              void start();
                          }
                        }}
                      />
                    </label>
                    <button
                      className="primary"
                      disabled={busy || !profile?.connected || !chosenModel || !prompt.trim()}
                    >
                      {busy ? 'Starting…' : pending ? 'Retry same request' : 'Start chat'}
                    </button>
                  </>
                )}
                {!!pending && (
                  <button type="button" disabled={busy} onClick={() => void recover()}>
                    Check request receipt
                  </button>
                )}
                {fresh && (
                  <button type="button" onClick={() => setFresh(false)}>
                    Back to conversation
                  </button>
                )}
                {(error || state.error) && <p role="alert">{error || state.error?.message}</p>}
              </form>
            )}
          </>
        )}
      </dialog>
    </>
  );
}

function PrivateHelperChat({
  current,
  refresh,
}: {
  current: NonNullable<HelperState['current']>;
  refresh: () => void;
}) {
  const key = `relay-helper-message:${current.id}`;
  const [draft, setDraft] = useState(() => sessionStorage.getItem(key) ?? '');
  const [pending, setPending] = useState(() => sessionStorage.getItem(key + ':pending') ?? '');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'nearest' });
  }, [current.messages.length, current.messages.at(-1)?.content, current.status]);
  const stop = async () => {
    try {
      await api('/api/helper/stop', { method: 'POST' });
      refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const send = async () => {
    if (sending || (!draft.trim() && !pending)) return;
    setSending(true);
    setError('');
    const body =
      pending ||
      JSON.stringify({ requestId: crypto.randomUUID(), conversationId: current.id, prompt: draft });
    sessionStorage.setItem(key + ':pending', body);
    setPending(body);
    try {
      await api('/api/helper/messages', { method: 'POST', body });
      sessionStorage.removeItem(key + ':pending');
      sessionStorage.removeItem(key);
      setPending('');
      setDraft('');
      refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  };
  return (
    <div className="helper-conversation main-pane">
      <div className="helper-private-messages" role="log" aria-label="Helper conversation">
        {current.messages.map((m, i) => (
          <article className={`helper-private-message ${m.role}`} key={i}>
            <strong>{m.role === 'user' ? 'You' : 'Relay helper'}</strong>
            {m.role === 'assistant' ? (
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
            ) : (
              <p>{m.content}</p>
            )}
          </article>
        ))}
        <p role="status">{current.status === 'running' ? 'Working…' : (current.error ?? '')}</p>
        <div ref={end} />
      </div>
      <form
        className="helper-private-composer"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        {(error || pending) && (
          <p role="alert">
            {error || 'Message delivery needs checking. Retry uses the same request ID.'}
          </p>
        )}
        <label htmlFor="helper-message">Message</label>
        <textarea
          id="helper-message"
          value={draft}
          disabled={sending || !!pending}
          rows={2}
          onChange={(e) => {
            setDraft(e.target.value);
            sessionStorage.setItem(key, e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && current.status === 'running') {
              e.preventDefault();
              e.stopPropagation();
              void stop();
            }
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              if (e.ctrlKey) {
                e.preventDefault();
                const f = e.currentTarget,
                  a = f.selectionStart,
                  b = f.selectionEnd;
                const value = draft.slice(0, a) + '\n' + draft.slice(b);
                setDraft(value);
                sessionStorage.setItem(key, value);
                requestAnimationFrame(() => f.setSelectionRange(a + 1, a + 1));
              } else if (!e.shiftKey) {
                e.preventDefault();
                if (current.status !== 'running') void send();
              }
            }
          }}
        />
        {current.status === 'running' && !draft.trim() ? (
          <button type="button" onClick={() => void stop()}>
            Stop
          </button>
        ) : (
          <button disabled={sending || current.status === 'running' || (!draft.trim() && !pending)}>
            {pending ? 'Retry same request' : sending ? 'Sending…' : 'Send'}
          </button>
        )}
        <small>
          {current.model} ·{' '}
          {current.usage ? `${current.usage.total.toLocaleString()} tokens` : 'Usage unavailable'} ·
          App agent
        </small>
      </form>
    </div>
  );
}
