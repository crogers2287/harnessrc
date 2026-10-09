import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MoreHorizontal, Pin, Pencil, Archive, RotateCcw, X, Square, Info } from 'lucide-react';
import { api } from '@harnessrc/client-sdk';
import type { SessionView } from '@harnessrc/protocol';
export const sessionLabel = (s: SessionView) =>
  s.relayName || s.sessionName || s.tabName || s.project;

/** Scrolling cancels a hold; the ensuing click cannot open the conversation. */
export function SessionRow({
  session,
  selected,
  open,
  children,
}: {
  session: SessionView;
  selected: boolean;
  open: () => void;
  children: ReactNode;
}) {
  const [actions, setActions] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const start = useRef({ x: 0, y: 0 });
  const held = useRef(false);
  const cancel = () => clearTimeout(timer.current);
  useEffect(() => cancel, []);
  return (
    <div className={`session-row-wrap ${selected ? 'selected' : ''}`}>
      <button
        className={`session-row ${selected ? 'selected' : ''}`}
        onClick={() => {
          if (held.current) {
            held.current = false;
            return;
          }
          open();
        }}
        onPointerDown={(e) => {
          cancel();
          held.current = false;
          if (!e.isPrimary || e.button !== 0) return;
          start.current = { x: e.clientX, y: e.clientY };
          timer.current = setTimeout(() => {
            held.current = true;
            setActions(true);
          }, 500);
        }}
        onPointerMove={(e) => {
          if (Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > 10) cancel();
        }}
        onPointerUp={cancel}
        onPointerCancel={cancel}
        onPointerLeave={cancel}
        onContextMenu={(e) => {
          e.preventDefault();
          cancel();
          held.current = true;
          setActions(true);
        }}
      >
        {children}
      </button>
      <button
        className="session-row-menu"
        aria-label={`Actions for ${sessionLabel(session)}`}
        onClick={() => setActions(true)}
      >
        <MoreHorizontal size={20} />
      </button>
      {actions && <SessionActions session={session} close={() => setActions(false)} />}
    </div>
  );
}

function SessionActions({ session: s, close }: { session: SessionView; close: () => void }) {
  const [mode, setMode] = useState<'menu' | 'rename' | 'archive' | 'interrupt'>('menu');
  const [name, setName] = useState(sessionLabel(s));
  const dialog = useRef<HTMLDialogElement>(null);
  const backdropPress = useRef(false);
  const closeRef = useRef(close);
  closeRef.current = close;
  const query = useQueryClient();
  const mutation = useMutation({
    mutationFn: (patch: Record<string, unknown>) =>
      api(`/api/sessions/${s.id}/${mode === 'interrupt' ? 'interrupt' : 'preferences'}`, {
        method: mode === 'interrupt' ? 'POST' : 'PATCH',
        body: JSON.stringify(patch),
      }),
    onSuccess: async () => {
      await query.invalidateQueries({ queryKey: ['sessions'] });
      close();
    },
  });
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    dialog.current?.showModal();
    const state = history.state;
    history.pushState({ ...state, relaySessionActions: true }, '', location.href);
    const pop = () => closeRef.current();
    window.addEventListener('popstate', pop);
    return () => {
      window.removeEventListener('popstate', pop);
      if (history.state?.relaySessionActions) history.back();
      previous?.focus({ preventScroll: true });
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="session-action-sheet"
      aria-labelledby="session-action-title"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onKeyDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        backdropPress.current =
          e.target === e.currentTarget &&
          (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom);
      }}
      onClick={(e) => {
        // The finger releasing the hold must not also dismiss the newly opened sheet.
        if (backdropPress.current && e.target === e.currentTarget) close();
        backdropPress.current = false;
      }}
    >
      <header>
        <div>
          <h2 id="session-action-title">
            {mode === 'rename'
              ? 'Rename conversation'
              : mode === 'archive'
                ? 'Close conversation?'
                : mode === 'interrupt'
                  ? 'Stop current turn?'
                  : sessionLabel(s)}
          </h2>
          <p>
            {s.agentPreset || s.harness} · {s.hostId}
          </p>
        </div>
        <button aria-label="Close session actions" onClick={close}>
          <X size={22} />
        </button>
      </header>
      {mode === 'menu' ? (
        <div className="session-action-list">
          {s.canManage && (
            <>
              <button onClick={() => setMode('rename')}>
                <Pencil size={20} /> Rename
              </button>
              <button
                disabled={mutation.isPending}
                onClick={() => mutation.mutate({ pinned: !s.pinned })}
              >
                <Pin size={20} /> {s.pinned ? 'Unpin' : 'Pin to top'}
              </button>
              <button
                disabled={mutation.isPending}
                onClick={() =>
                  s.archived ? mutation.mutate({ archived: false }) : setMode('archive')
                }
              >
                {s.archived ? <RotateCcw size={20} /> : <Archive size={20} />}
                {s.archived ? 'Reopen conversation' : 'Close conversation'}
              </button>
              {s.capabilities.interruptTurn &&
                s.connected &&
                ['working', 'blocked'].includes(s.status) && (
                  <button className="danger" onClick={() => setMode('interrupt')}>
                    <Square size={20} /> Stop current turn
                  </button>
                )}
            </>
          )}
          <div className="session-action-location">
            <Info size={18} />
            <code>{s.cwd}</code>
          </div>
        </div>
      ) : mode === 'rename' ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!mutation.isPending) mutation.mutate({ name });
          }}
        >
          <label>
            Conversation name
            <input
              value={name}
              maxLength={120}
              required
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <p className="muted">This name is saved in Relay across your devices.</p>
          <button className="primary" disabled={mutation.isPending || !name.trim()}>
            {mutation.isPending ? 'Saving…' : 'Save name'}
          </button>
        </form>
      ) : (
        <div>
          <p>
            {mode === 'archive'
              ? 'Move this conversation to History. The agent and queued work keep running; you can reopen it anytime.'
              : 'Stop the agent’s current work. The conversation and queued follow-ups remain saved.'}
          </p>
          <div className="session-action-confirm">
            <button onClick={() => setMode('menu')}>Cancel</button>
            <button
              className={mode === 'interrupt' ? 'danger' : 'primary'}
              disabled={mutation.isPending}
              onClick={() =>
                mutation.mutate(mode === 'interrupt' ? { confirm: true } : { archived: true })
              }
            >
              {mutation.isPending
                ? 'Applying…'
                : mode === 'interrupt'
                  ? 'Stop turn'
                  : 'Move to History'}
            </button>
          </div>
        </div>
      )}
      {mutation.error && (
        <p role="alert" className="error">
          {mutation.error.message}
        </p>
      )}
    </dialog>
  );
}
