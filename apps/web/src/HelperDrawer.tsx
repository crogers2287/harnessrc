import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@harnessrc/client-sdk';
import type { SessionView } from '@harnessrc/protocol';
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
    sessionId?: string;
    receipt: { status: string; diagnostic?: string };
  };
};
type Route = { session?: string; view?: string; interaction?: string };
export function HelperDrawer({
  open,
  show,
  close,
  sessions,
  render,
  openSession,
}: {
  open: boolean;
  show: () => void;
  close: () => void;
  sessions: SessionView[];
  render: (
    session: SessionView,
    route: Route,
    navigate: (route: Route) => void,
    back: () => void,
  ) => ReactNode;
  openSession: (sessionId: string, interactionId: string) => void;
}) {
  const panel = useRef<HTMLDialogElement>(null);
  const query = useQueryClient();
  const state = useQuery<HelperState>({
    queryKey: ['helper'],
    queryFn: () => api('/api/helper'),
    enabled: open,
    refetchInterval: open ? 3000 : false,
  });
  const [route, navigate] = useState<Route>({});
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
  const session = sessions.find((s) => s.id === current?.sessionId);
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
        try {
          await api(`/api/launch/${JSON.parse(pending).requestId}`);
          setError('Launch was received. Reopen the helper to check its status.');
        } catch (e) {
          if (e instanceof ApiError && e.status === 404) {
            setPending('');
            sessionStorage.removeItem('relay-helper-pending');
            setError('No launch was created. You can edit the settings and try again.');
          } else throw e;
        }
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
      navigate({});
      await Promise.all([
        query.invalidateQueries({ queryKey: ['helper'] }),
        query.invalidateQueries({ queryKey: ['sessions'] }),
      ]);
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
                    navigate({});
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
              session ? (
                <div className="helper-conversation main-pane">
                  {render(session, route, navigate, () => (route.view ? navigate({}) : close()))}
                </div>
              ) : (
                <div className="helper-setup">
                  <p role="status">
                    {current.receipt.status === 'uncertain'
                      ? 'Launch needs checking'
                      : 'Connecting to your helper…'}
                  </p>
                  <p>
                    {current.receipt.diagnostic ||
                      'The conversation will appear when the native session is ready. You can close this panel while it starts.'}
                  </p>
                  <button onClick={() => void state.refetch()}>Check status</button>
                </div>
              )
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
                    Enable a helper launch profile on the gateway with your CFR proxy connection and
                    Relay MCP. No host or model is built into the app.
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
                    Check launch receipt
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
