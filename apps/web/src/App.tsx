import { NativeMedia, NativeMediaGallery, MediaPreviewProvider } from './NativeMedia.tsx';
import { nativeFiles } from '@harnessrc/protocol';
import { notifyEvent } from './notifications.ts';
import { DshQuestions } from './DshQuestions.tsx';
import { SessionRow, sessionLabel } from './SessionActions.tsx';
import { useVoiceInput } from './voice.tsx';
import { SessionFilters } from './SessionFilters.tsx';
import {
  agentLabel,
  defaultFilters,
  filterSessions,
  isSaved,
  type SessionFilters as FilterState,
} from './session-filters.ts';
import { InstallApp } from './InstallApp.tsx';
import { DshModel } from './DshModel.tsx';
import { TextArea } from '@harnessrc/ui';
import { presentUserMessage, toolLabel } from '@harnessrc/protocol';
import { OutgoingMessages, useOutgoing } from './outgoing.tsx';
import { NewSession } from './NewSession.tsx';
import { SessionDrawer } from './SessionDrawer.tsx';
import { useEffect, useRef, useState, useMemo, type FormEvent, type ReactNode } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import {
  ArrowLeft,
  ArrowDown,
  ArrowUp,
  Check,
  ChevronRight,
  CircleHelp,
  Info,
  Layers,
  ListTodo,
  MessageSquare,
  SquarePen,
  Menu,
  MoreHorizontal,
  Search,
  Settings,
  ShieldCheck,
  Wifi,
  WifiOff,
  X,
  Pause,
  Play,
  Copy,
  Download,
} from 'lucide-react';
import {
  AttachmentPicker,
  AttachmentTray,
  useAttachments,
  SentAttachment,
} from './attachments.tsx';
import { api, Connection } from '@harnessrc/client-sdk';
import type { SessionView, Event, Interaction, Task } from '@harnessrc/protocol';
import { Status, IconButton, Empty } from '@harnessrc/ui';
type Detail = { session: SessionView; interactions: Interaction[]; tasks: Task[] };
type Route = { session?: string; view?: string; interaction?: string };
const getRoute = (): Route => Object.fromEntries(new URLSearchParams(location.search));
const previewText = (text: string) =>
  text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`#]/g, '')
    .trim();
const scrollPositions = new Map<string, number>();
const drafts = new Map<string, string>();
function restoreDraft(id: string) {
  try {
    return drafts.get(id) ?? sessionStorage.getItem(`relay-draft:${id}`) ?? '';
  } catch {
    return drafts.get(id) ?? '';
  }
}
function when(value: string) {
  const ms = Date.now() - Date.parse(value);
  if (ms < 60000) return 'Just now';
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m ago`;
  if (ms < 86400000) return `${Math.floor(ms / 3600000)}h ago`;
  return new Date(value).toLocaleDateString();
}
function Mark({ text, event }: { text: string; event?: Event }) {
  return (
    <Markdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeHighlight]}
      components={{
        p: ({ children }) => <div className="markdown-paragraph">{children}</div>,
        table: ({ children }) => (
          <div
            className="markdown-table-scroll"
            tabIndex={0}
            role="region"
            aria-label="Scrollable table"
          >
            <table>{children}</table>
          </div>
        ),
        img: ({ src, alt }) => {
          const index = event
            ? nativeFiles(event).findIndex((f) => f.path === src || encodeURI(f.path) === src)
            : -1;
          return event && index >= 0 ? (
            <NativeMedia event={event} index={index} />
          ) : (
            <img src={src} alt={alt ?? ''} loading="lazy" />
          );
        },
      }}
    >
      {text}
    </Markdown>
  );
}
export function App() {
  const query = useQueryClient();
  const [route, setRoute] = useState(getRoute);
  const [connection, setConnection] = useState<'connected' | 'reconnecting'>('reconnecting');
  const [filters, setFilters] = useState<FilterState>(() => {
    try {
      return {
        ...defaultFilters,
        ...JSON.parse(sessionStorage.getItem('relay-session-filters') ?? '{}'),
      };
    } catch {
      return defaultFilters;
    }
  });
  useEffect(() => {
    try {
      sessionStorage.setItem('relay-session-filters', JSON.stringify(filters));
    } catch {
      /* Optional storage. */
    }
  }, [filters]);
  const [drawerOpen, setDrawerOpen] = useState(() => !!history.state?.relayDrawer);
  const [mobile, setMobile] = useState(() => matchMedia('(max-width: 767px)').matches);
  const openDrawer = () => {
    if (matchMedia('(max-width: 767px)').matches && !history.state?.relayDrawer)
      history.pushState({ relayDrawer: true }, '', location.href);
    setDrawerOpen(true);
  };
  const closeDrawer = () => {
    if (history.state?.relayDrawerBase) {
      history.pushState({ relayChat: true }, '', location.href);
      setDrawerOpen(false);
    } else if (history.state?.relayDrawer) history.back();
    else setDrawerOpen(false);
  };
  useEffect(() => {
    const media = matchMedia('(max-width: 767px)');
    const changed = () => setMobile(media.matches);
    media.addEventListener('change', changed);
    return () => media.removeEventListener('change', changed);
  }, []);
  const [read, setRead] = useState<Record<string, string>>({});
  const auth = useQuery({ queryKey: ['me'], queryFn: () => api('/api/auth/me') });
  const inbox = useQuery<{ sessions: SessionView[] }>({
    queryKey: ['sessions'],
    queryFn: () => api('/api/sessions'),
    enabled: !!auth.data,
  });
  const sessions = inbox.data?.sessions ?? [];
  const navigate = (next: Route) => {
    const params = new URLSearchParams(
      Object.entries(next).filter(([, v]) => v !== undefined) as [string, string][],
    );
    const url = params.size ? `/?${params}` : '/';
    if (mobile && next.session && !next.view) {
      // The drawer is the parent of a mobile conversation, including deep links.
      if (history.state?.relayDrawer)
        history.replaceState({ relayDrawer: true, relayDrawerBase: true }, '', url);
      else history.pushState({ relayDrawer: true, relayDrawerBase: true }, '', url);
      history.pushState({ relayChat: true }, '', url);
    } else if (history.state?.relayDrawer && !history.state?.relayDrawerBase)
      history.replaceState({}, '', url);
    else history.pushState({}, '', url);
    setRoute(next);
    setDrawerOpen(false);
    if (next.session) localStorage.setItem('relay-last-session', next.session);
  };
  useEffect(() => {
    const handler = () => {
      setRoute(getRoute());
      setDrawerOpen(!!history.state?.relayDrawer);
    };
    window.addEventListener('popstate', handler);
    return () => window.removeEventListener('popstate', handler);
  }, []);
  useEffect(() => {
    if (!auth.data) return;
    const channel = new Connection(
      (items) => {
        query.setQueryData(['sessions'], { sessions: items });
        void query.invalidateQueries({ queryKey: ['detail'] });
      },
      (state) => {
        setConnection(state);
        // Replay on reconnect; ordinary stream events are appended in place.
        if (state === 'connected') void query.invalidateQueries({ queryKey: ['events'] });
      },
      (event) => {
        const session = query
          .getQueryData<{ sessions: SessionView[] }>(['sessions'])
          ?.sessions.find((s) => s.id === event.sessionId);
        void notifyEvent(event, session);
        const key = ['events', event.sessionId];
        if (!query.getQueryData(key)) return;
        query.setQueryData<{ events: Event[] }>(key, (old) => ({
          events: [...new Map([...(old?.events ?? []), event].map((e) => [e.id, e])).values()]
            .sort((a, b) => a.sequence - b.sequence)
            .slice(-100),
        }));
      },
    );
    channel.start();
    return () => channel.stop();
  }, [auth.data, query]);
  useEffect(() => {
    if (!route.session) return;
    const current = sessions.find((s) => s.id === route.session);
    if (current) setRead((old) => ({ ...old, [current.id]: current.lastActivity }));
  }, [route.session, sessions]);
  useEffect(() => {
    const old = sessions.find((s) => s.id === route.session);
    if (!old?.nativeSessionId.startsWith('unbound:') || old.status !== 'ended') return;
    const bound = sessions.find(
      (s) =>
        s.hostId === old.hostId &&
        s.terminalId === old.terminalId &&
        s.connected &&
        !s.nativeSessionId.startsWith('unbound:'),
    );
    if (!bound) return;
    const next = { ...route, session: bound.id };
    const url = new URL(window.location.href);
    url.searchParams.set('session', bound.id);
    window.history.replaceState({}, '', url);
    setRoute(next);
  }, [route, sessions]);
  useEffect(() => {
    const open = () => {
      if (!history.state?.relayDrawer) history.pushState({ relayDrawer: true }, '', location.href);
      setDrawerOpen(true);
    };
    window.addEventListener('relay-open-sessions', open);
    return () => window.removeEventListener('relay-open-sessions', open);
  }, []);
  useEffect(() => {
    if (route.session || route.view || !sessions.length) return;
    const live = sessions.filter((s) => !isSaved(s));
    const saved = localStorage.getItem('relay-last-session');
    const session =
      live.find((s) => s.id === saved) ??
      [...live].sort((a, b) => Date.parse(b.lastActivity) - Date.parse(a.lastActivity))[0];
    if (!session) return;
    history.replaceState(history.state, '', `/?session=${session.id}`);
    setRoute({ session: session.id });
  }, [sessions, route]);
  useEffect(() => {
    if (
      !mobile ||
      !auth.data ||
      !route.session ||
      route.view ||
      history.state?.relayChat ||
      history.state?.relayDrawer
    )
      return;
    history.replaceState({ relayDrawer: true, relayDrawerBase: true }, '', location.href);
    history.pushState({ relayChat: true }, '', location.href);
  }, [mobile, auth.data, route]);
  if (auth.isPending)
    return (
      <main className="pairing">
        <p role="status">Connecting to your gateway…</p>
      </main>
    );
  if (!auth.data) return <Pair onPaired={() => void query.invalidateQueries()} />;
  const selected = sessions.find((s) => s.id === route.session);
  const shown = filterSessions(sessions, filters);
  return (
    <div className={`app ${route.session || route.view ? 'has-detail' : ''}`}>
      <SessionDrawer open={drawerOpen} close={closeDrawer}>
        <header className="brand">
          <div className="brand-mark">
            <MessageSquare size={23} aria-hidden="true" />
          </div>
          <div>
            <h1>Relay</h1>
            <span>Your agent workspace</span>
          </div>
        </header>
        <div className="inbox-heading">
          <h2>Sessions</h2>
          <span className="count">{shown.length}</span>
          {!!auth.data.device.admin && (
            <button
              className="new-session-trigger"
              aria-label="New session"
              onClick={() => navigate({ view: 'new' })}
            >
              <SquarePen size={20} aria-hidden="true" />
              <span className="sr-only">New session</span>
            </button>
          )}
          <span className="host-health">
            <span
              className={connection === 'connected' ? 'online' : 'offline'}
              aria-hidden="true"
            />
            {connection === 'connected' ? 'Live updates' : 'Reconnecting'}
          </span>
        </div>
        <label className="search">
          <Search size={18} aria-hidden="true" />
          <span className="sr-only">Search sessions</span>
          <input
            type="search"
            placeholder="Session, agent, directory, host…"
            value={filters.search}
            onChange={(e) => setFilters({ ...filters, search: e.target.value })}
          />
        </label>
        <SessionFilters
          sessions={sessions}
          value={filters}
          onChange={setFilters}
          count={shown.length}
        />
        <div className="session-list">
          {[...new Set(shown.map((s) => s.harness))].sort().map((harness) => (
            <section
              className="agent-group"
              key={harness}
              aria-label={`${agentLabel(harness)} sessions`}
            >
              <h3 className="agent-group-heading">
                {agentLabel(harness)}{' '}
                <span>{shown.filter((s) => s.harness === harness).length}</span>
              </h3>
              {shown
                .filter((s) => s.harness === harness)
                .map((s) => (
                  <SessionRow
                    session={s}
                    selected={selected?.id === s.id}
                    key={s.id}
                    open={() => navigate({ session: s.id })}
                  >
                    <div className={`harness-mark ${s.harness}`} aria-hidden="true">
                      {s.harness === 'claude'
                        ? 'C'
                        : s.harness === 'codex'
                          ? '⌘'
                          : s.harness.slice(0, 1).toUpperCase()}
                    </div>
                    <div className="session-summary">
                      <div className="row-title">
                        <strong>
                          {s.pinned ? '★ ' : ''}
                          {sessionLabel(s)}
                        </strong>
                      </div>
                      <div className="session-meta compact-session-meta">
                        <span>
                          {s.agentPreset ? `${s.agentPreset} · ` : ''}
                          {s.model || agentLabel(s.harness)}
                        </span>
                        <span>{s.hostId}</span>
                      </div>
                      <div className="session-cwd" title={s.cwd}>
                        <span>CWD</span> <code>{s.cwd || 'Not reported'}</code>
                      </div>

                      <p>
                        {previewText(s.preview) ||
                          (s.capabilities.sendMessage
                            ? 'Start a conversation'
                            : 'Chat connection needs attention')}
                      </p>
                      <div className="row-bottom">
                        {isSaved(s) ? (
                          <span className="saved-session-label">Saved session</span>
                        ) : (
                          <Status status={s.status} />
                        )}
                        <time dateTime={s.lastActivity}>{when(s.lastActivity)}</time>
                        {s.pendingCount > 0 && (
                          <span className="attention-count">
                            <CircleHelp size={14} aria-hidden="true" />
                            {s.pendingCount} waiting
                          </span>
                        )}
                        {s.queuedCount > 0 && (
                          <span className="queued-count">{s.queuedCount} queued</span>
                        )}
                      </div>
                    </div>
                    {!isSaved(s) && read[s.id] !== s.lastActivity && (
                      <span className="unread" aria-label="Unread activity" />
                    )}
                  </SessionRow>
                ))}
            </section>
          ))}
          {shown.length === 0 && (
            <Empty title={sessions.length ? 'No matching sessions' : 'No sessions yet'}>
              {sessions.length
                ? 'Change filters or switch between Live and History.'
                : 'Existing Herdr sessions appear here automatically. Check host connectivity in Settings.'}
            </Empty>
          )}
        </div>
        <nav className="sidebar-nav">
          <button onClick={() => navigate({ view: 'attention' })}>
            <CircleHelp size={20} aria-hidden="true" />
            Needs attention{' '}
            <span className="count">{sessions.reduce((n, s) => n + s.pendingCount, 0)}</span>
          </button>
          <button onClick={() => navigate({ view: 'settings' })}>
            <Settings size={20} aria-hidden="true" />
            Settings
          </button>
        </nav>
      </SessionDrawer>
      <main className="main-pane" inert={drawerOpen && mobile}>
        {route.view === 'new' ? (
          <NewSession
            sessions={sessions}
            back={() => navigate(selected ? { session: selected.id } : {})}
            opened={(id) => navigate({ session: id })}
          />
        ) : route.view === 'settings' ? (
          <SettingsView admin={!!auth.data.device.admin} back={() => navigate({})} />
        ) : route.view === 'attention' ? (
          <Attention sessions={sessions} navigate={navigate} />
        ) : selected ? (
          <Conversation
            key={selected.id}
            session={selected}
            connection={connection}
            route={route}
            back={openDrawer}
            navigate={navigate}
          />
        ) : (
          <div className="welcome">
            <div className="welcome-icon">
              <MessageSquare size={32} aria-hidden="true" />
            </div>
            <h2>Your work, within reach.</h2>
            <button className="primary" onClick={openDrawer}>
              Open sessions
            </button>
            <p>
              Open a session to follow the conversation, answer a question, or queue what comes
              next.
            </p>
            <div className="welcome-note">
              <ShieldCheck size={18} aria-hidden="true" />
              Private connection. Your agents keep running.
            </div>
            {inbox.error && <p role="alert">{inbox.error.message}</p>}
          </div>
        )}
      </main>
    </div>
  );
}
function Pair({ onPaired }: { onPaired: () => void }) {
  const [key, setKey] = useState('');
  const [name, setName] = useState('My device');
  const mutation = useMutation({
    mutationFn: () =>
      api('/api/auth/pair', { method: 'POST', body: JSON.stringify({ key, name }) }),
    onSuccess: () => {
      setKey('');
      onPaired();
    },
  });
  return (
    <main className="pairing">
      <div className="pair-card">
        <div className="brand-mark">
          <MessageSquare size={26} aria-hidden="true" />
        </div>
        <h1>Connect to Relay</h1>
        <p>Pair this device with your private agent gateway.</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate();
          }}
        >
          <label>
            Device name
            <input
              autoComplete="nickname"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={80}
            />
          </label>
          <label>
            Pairing key
            <input
              type="password"
              autoComplete="current-password"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              required
              minLength={32}
            />
          </label>
          <p className="helper">
            Use the gateway’s initial pairing key or a new key from an authorized device.
          </p>
          {mutation.error && (
            <p role="alert" className="error">
              {mutation.error.message}
            </p>
          )}
          <button className="primary" disabled={mutation.isPending || !name || key.length < 32}>
            {mutation.isPending ? 'Connecting…' : 'Connect device'}
          </button>
        </form>
        <div className="privacy-note">
          <ShieldCheck size={17} aria-hidden="true" />
          Credentials stay in secure, HttpOnly cookies.
        </div>
      </div>
    </main>
  );
}
function PageHeader({
  title,
  back,
  children,
}: {
  title: string;
  back: () => void;
  children?: ReactNode;
}) {
  return (
    <header className="page-header">
      <IconButton label="Back to sessions" onClick={back}>
        <ArrowLeft size={22} />
      </IconButton>
      <h2>{title}</h2>
      {children}
    </header>
  );
}
function Conversation({
  session,
  connection,
  route,
  back,
  navigate,
}: {
  session: SessionView;
  connection: string;
  route: Route;
  back: () => void;
  navigate: (route: Route) => void;
}) {
  const query = useQueryClient();
  const detail = useQuery<Detail>({
    queryKey: ['detail', session.id],
    queryFn: () => api(`/api/sessions/${session.id}`),
  });
  const events = useQuery<{ events: Event[] }>({
    queryKey: ['events', session.id],
    queryFn: () =>
      api(
        `/api/sessions/${session.id}/events?before=${Number.MAX_SAFE_INTEGER}&limit=100&conversation=1`,
      ),
  });
  const [history, setHistory] = useState<Event[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [draft, setDraft] = useState(restoreDraft(session.id));
  const attachments = useAttachments(session.id);
  const voice = useVoiceInput(session.id, (text) =>
    setDraft((current) => (current ? `${current.trimEnd()}\n${text}` : text)),
  );
  const [behavior, setBehavior] = useState('auto');
  const [contextOpen, setContextOpen] = useState(false);
  const mode =
    behavior === 'queue'
      ? 'queue'
      : ['working', 'blocked'].includes(session.status) && session.capabilities.steerActiveTurn
        ? 'steer'
        : 'send';
  const busyWithoutSteering = mode === 'send' && !['idle', 'done'].includes(session.status);
  const [notice, setNotice] = useState('');
  const [receiptId, setReceiptId] = useState<string>();
  const [atBottom, setAtBottom] = useState(true);
  const scroll = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const composerArea = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const input = composer.current;
    if (!input) return;
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
  }, [draft]);
  useEffect(() => {
    const area = composerArea.current;
    const pane = area?.closest<HTMLElement>('.main-pane');
    if (!area || !pane) return;
    const observer = new ResizeObserver(() => {
      pane.style.setProperty('--composer-height', `${area.getBoundingClientRect().height}px`);
      if (pinned.current && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
    });
    observer.observe(area);
    return () => observer.disconnect();
  }, [route.view]);
  const restored = useRef(false);
  const pinned = useRef(true);
  const transcript = useRef<HTMLDivElement>(null);
  const submission = useRef<
    { prompt: string; key: string; attachments: string[]; mode: string } | undefined
  >(undefined);
  const lastCount = useRef(0);
  const merged = useMemo(() => {
    const all = new Map([...history, ...(events.data?.events ?? [])].map((e) => [e.id, e]));
    return [...all.values()].sort((a, b) => a.sequence - b.sequence);
  }, [history, events.data]);
  const visible = useMemo(() => conversationItems(merged), [merged]);
  const virtual = useVirtualizer({
    count: visible.length,
    getScrollElement: () => scroll.current,
    estimateSize: () => 140,
    overscan: 5,
    getItemKey: (index) => visible[index].id,
  });
  useEffect(() => {
    drafts.set(session.id, draft);
    try {
      sessionStorage.setItem(`relay-draft:${session.id}`, draft);
    } catch {
      /* Storage unavailable. */
    }
  }, [draft, session.id]);
  useEffect(() => {
    if (!events.data) return;
    setHistory((old) => {
      const all = new Map([...old, ...events.data!.events].map((e) => [e.id, e]));
      return [...all.values()];
    });
  }, [events.data]);
  useEffect(() => {
    if (route.view) {
      restored.current = false;
      return;
    }
    if (!visible.length) return;
    if (!restored.current) {
      const offset = scrollPositions.get(session.id);
      if (offset !== undefined) virtual.scrollToOffset(offset);
      else virtual.scrollToIndex(visible.length - 1, { align: 'end' });
      restored.current = true;
    } else if (atBottom && visible.length !== lastCount.current)
      virtual.scrollToIndex(visible.length - 1, { align: 'end' });
    lastCount.current = visible.length;
  }, [visible.length, virtual, session.id, atBottom, route.view]);
  useEffect(() => {
    const element = transcript.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      if (pinned.current && restored.current && scroll.current)
        scroll.current.scrollTop = scroll.current.scrollHeight;
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [route.view]);
  const outgoing = useOutgoing(session.id, merged);
  const send = useMutation({
    mutationFn: (value: { prompt: string; key: string; attachments: string[]; mode: string }) =>
      api(`/api/sessions/${session.id}/${value.mode === 'queue' ? 'tasks' : 'messages'}`, {
        method: 'POST',
        body: JSON.stringify({
          prompt: value.prompt,
          idempotencyKey: value.key,
          attachments: value.attachments,
        }),
      }),
    onSuccess: (_result, submitted) => {
      setReceiptId(_result?.task?.id);
      if (submitted.mode === 'queue')
        setDraft((current) => (current === submitted.prompt ? '' : current));
      else
        outgoing.finish(
          submitted.key,
          'confirmed',
          _result?.task?.id,
          ['dsh', 'claude'].includes(session.harness) && _result?.mode === 'steer'
            ? 'next-step'
            : undefined,
        );
      attachments.clear(submitted.attachments);
      submission.current = undefined;
      setNotice(
        _result?.mode === 'steer'
          ? session.harness === 'dsh'
            ? 'Steering accepted. DSH will apply it at the next step.'
            : session.harness === 'claude'
              ? 'Steering accepted. Waiting for Claude’s next tool step.'
              : 'Active turn updated.'
          : submitted.mode === 'queue'
            ? 'Queued for a later turn.'
            : 'Message sent.',
      );
      void query.invalidateQueries({ queryKey: ['detail', session.id] });
    },
    onError: (_error, submitted) => {
      if (submitted.mode !== 'queue') {
        outgoing.finish(submitted.key, 'uncertain');
        setNotice('Delivery was not confirmed. Your message is preserved above.');
      } else
        setNotice(
          'Your draft is preserved. Check the queue before retrying if delivery is uncertain.',
        );
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (
      (!draft.trim() && !attachments.files.length) ||
      send.isPending ||
      busyWithoutSteering ||
      voice.busy ||
      attachments.busy ||
      attachments.invalid
    )
      return;
    const ids = attachments.files.flatMap((f) => (f.id ? [f.id] : []));
    const prompt = draft || 'Please review the attached files.';
    if (
      submission.current?.prompt !== prompt ||
      JSON.stringify(submission.current?.attachments) !== JSON.stringify(ids) ||
      submission.current?.mode !== mode
    )
      submission.current = { prompt, key: crypto.randomUUID(), attachments: ids, mode };
    if (mode !== 'queue') {
      setReceiptId(undefined);
      setNotice('');
      outgoing.begin(
        submission.current.key,
        prompt,
        attachments.files
          .filter((f) => f.id)
          .map((f) => ({ id: f.id!, name: f.name, mime: f.mime })),
      );
      setDraft('');
      composer.current?.focus({ preventScroll: true });
      if (composer.current) composer.current.style.height = 'auto';
      pinned.current = true;
      setAtBottom(true);
      requestAnimationFrame(() =>
        scroll.current?.scrollTo({ top: scroll.current.scrollHeight, behavior: 'instant' }),
      );
    }
    send.mutate(submission.current);
  };
  const pending = detail.data?.interactions.filter((i) => i.status === 'pending') ?? [];
  const receipt = detail.data?.tasks.find((t) => t.id === receiptId);
  const receiptStatus = receipt
    ? {
        pending: 'Instruction queued. It will run when your agent is ready.',
        dispatching: 'Sending to your agent…',
        running: 'Sent. Your agent is working.',
        completed: 'Last instruction completed.',
        failed: 'Instruction failed. Open the queue for details.',
        cancelled: 'Instruction cancelled.',
        uncertain: 'Delivery uncertain. Check the queue before retrying.',
      }[receipt.status]
    : undefined;
  const loadOlder = async () => {
    if (loadingMore) return;
    setLoadingMore(true);
    pinned.current = false;
    setAtBottom(false);
    try {
      const first = merged[0]?.sequence ?? Number.MAX_SAFE_INTEGER;
      const result = await api<{ events: Event[] }>(
        `/api/sessions/${session.id}/events?before=${first}&limit=100&conversation=1`,
      );
      setHistory((old) => [...result.events, ...old]);
      setHasMore(result.events.length === 100);
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : 'Could not load earlier messages. Try again.',
      );
    } finally {
      setLoadingMore(false);
    }
  };
  if (route.view === 'queue')
    return (
      <>
        <PageHeader title="Task queue" back={() => navigate({ session: session.id })} />
        <QueueView session={session} tasks={detail.data?.tasks ?? []} />
      </>
    );
  if (route.view === 'details')
    return (
      <>
        <PageHeader title="Session details" back={() => navigate({ session: session.id })} />
        <SessionDetails session={session} />
      </>
    );
  return (
    <MediaPreviewProvider>
      <header className="conversation-header">
        <IconButton label="Open sessions" className="mobile-back" onClick={back}>
          <Menu size={22} />
        </IconButton>
        <div className="conversation-heading">
          <button
            className="conversation-title-button"
            aria-label="Show session information"
            aria-expanded={contextOpen}
            aria-controls="conversation-context"
            onClick={() => setContextOpen(!contextOpen)}
          >
            <h2 title={sessionLabel(session)}>{sessionLabel(session)}</h2>
            <span className="header-model">
              {agentLabel(session.harness)}
              {session.agentPreset ? ` · ${session.agentPreset}` : ''} ·{' '}
              {session.model || 'Model unknown'} <span aria-hidden="true">⌄</span>
            </span>
          </button>
        </div>
        <IconButton
          label={`Task queue, ${session.queuedCount} pending`}
          onClick={() => navigate({ session: session.id, view: 'queue' })}
        >
          <ListTodo size={22} />
          {session.queuedCount > 0 && <span className="icon-badge">{session.queuedCount}</span>}
        </IconButton>
        <IconButton
          label="Export loaded conversation"
          onClick={() => {
            const blob = new Blob(
              [
                merged
                  .map(
                    (e) =>
                      `## ${e.kind} · ${e.timestamp}\n\n${String(e.data.text ?? JSON.stringify(e.data))}`,
                  )
                  .join('\n\n'),
              ],
              { type: 'text/markdown' },
            );
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = 'conversation.md';
            link.click();
            URL.revokeObjectURL(url);
          }}
        >
          <Download size={20} />
        </IconButton>
        <IconButton
          label="Session details"
          onClick={() => navigate({ session: session.id, view: 'details' })}
        >
          <MoreHorizontal size={23} />
        </IconButton>
      </header>
      <div className="chat-context-strip">
        <Status status={session.status} />
        <span title={session.cwd}>{session.cwd || 'Directory not reported'}</span>
      </div>
      {contextOpen && (
        <section
          id="conversation-context"
          className="chat-context-panel"
          aria-label="Session information"
        >
          <dl>
            <dt>Agent</dt>
            <dd>{agentLabel(session.harness)}</dd>
            {session.agentPreset && (
              <>
                <dt>Agent profile</dt>
                <dd>{session.agentPreset}</dd>
              </>
            )}
            <dt>Model</dt>
            <dd>{session.model || 'Model unknown'}</dd>
            <dt>Host</dt>
            <dd>{session.hostId}</dd>
            <dt>Directory</dt>
            <dd>{session.cwd || 'Not reported'}</dd>
          </dl>
        </section>
      )}
      {connection !== 'connected' && (
        <div className="connection-banner" role="status">
          <WifiOff size={16} aria-hidden="true" />
          Reconnecting. Your agent keeps running.
        </div>
      )}
      <div
        className="conversation-scroll"
        ref={scroll}
        onScroll={() => {
          if (scroll.current) {
            scrollPositions.set(session.id, scroll.current.scrollTop);
            pinned.current =
              scroll.current.scrollHeight - scroll.current.scrollTop - scroll.current.clientHeight <
              100;
            setAtBottom(pinned.current);
          }
        }}
      >
        {hasMore && merged.length >= 100 && (
          <button className="load-older" onClick={() => void loadOlder()} disabled={loadingMore}>
            {loadingMore ? 'Loading…' : 'Load earlier messages'}
          </button>
        )}
        {events.isPending && (
          <p className="loading" role="status">
            Loading conversation…
          </p>
        )}
        {events.error && (
          <p className="error" role="alert">
            {events.error.message}
          </p>
        )}
        {visible.length === 0 && !events.isPending && !events.error && (
          <Empty
            title={
              !session.capabilities.readConversation
                ? 'Chat is not connected'
                : session.status === 'working'
                  ? 'Your agent is working'
                  : 'Send your first message'
            }
          >
            {!session.capabilities.readConversation
              ? 'The agent is running, but Relay has not connected its conversation yet. Open session details for the connection issue.'
              : session.status === 'working'
                ? 'Waiting for conversation updates. You can queue your next instruction below.'
                : 'Ask a question, describe a change, or attach a file to get started.'}
          </Empty>
        )}
        <div
          className="transcript"
          ref={transcript}
          style={{ height: virtual.getTotalSize(), position: 'relative' }}
        >
          {virtual.getVirtualItems().map((row) => (
            <div
              key={row.key}
              data-index={row.index}
              ref={virtual.measureElement}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${row.start}px)`,
              }}
            >
              <EventCard event={visible[row.index]} />
            </div>
          ))}
        </div>
        <OutgoingMessages
          sessionId={session.id}
          items={outgoing.items}
          restore={(text) => setDraft((current) => (current ? `${current}\n${text}` : text))}
          dismiss={outgoing.dismiss}
        />
        {session.capabilities.readConversation &&
          session.status === 'working' &&
          connection === 'connected' && (
            <WorkingIndicator
              harness={session.agentPreset || agentLabel(session.harness)}
              events={merged}
            />
          )}
        <div className="interaction-stack">
          {detail.data?.interactions
            .filter(
              (i) =>
                ['pending', 'responding', 'uncertain'].includes(i.status) ||
                i.id === route.interaction,
            )
            .map((i) => (
              <InteractionCard
                key={i.id}
                interaction={i}
                canRespond={
                  i.type.endsWith('approval')
                    ? session.capabilities.approveAction || session.capabilities.rejectAction
                    : session.capabilities.answerQuestion
                }
              />
            ))}
        </div>
      </div>
      {!atBottom && pending.length === 0 && (
        <button
          className="jump-latest"
          onClick={() => {
            virtual.scrollToIndex(visible.length - 1, { align: 'end' });
            scroll.current?.scrollTo({ top: scroll.current.scrollHeight });
            pinned.current = true;
            setAtBottom(true);
          }}
        >
          <ArrowDown size={17} aria-hidden="true" />
          Latest messages
        </button>
      )}
      <div className="composer-area" ref={composerArea}>
        {!!detail.data?.tasks.some((t) => t.status === 'pending') && (
          <button
            type="button"
            className="queue-peek"
            onClick={() => navigate({ session: session.id, view: 'queue' })}
          >
            <ListTodo size={18} />
            <span>
              <strong>Queued next</strong>{' '}
              {detail.data.tasks.find((t) => t.status === 'pending')?.prompt}
            </span>
            <ChevronRight size={18} />
          </button>
        )}
        {pending.length > 0 && (
          <button
            type="button"
            className="composer-hint attention-text pending-jump"
            onClick={() => {
              document.getElementById(`interaction-${pending[0].id}`)?.scrollIntoView({
                block: 'start',
                behavior: matchMedia('(prefers-reduced-motion: reduce)').matches
                  ? 'instant'
                  : 'smooth',
              });
            }}
          >
            <CircleHelp size={16} aria-hidden="true" />
            {pending.length} pending request{pending.length > 1 ? 's' : ''}. View and reply
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        )}
        {session.capabilities.queueTask ? (
          <form
            className="composer"
            onSubmit={submit}
            onDragOver={(e) => {
              if (session.capabilities.attachFiles) e.preventDefault();
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (session.capabilities.attachFiles)
                attachments.add(Array.from(e.dataTransfer.files));
            }}
            onPaste={(e) => {
              if (session.capabilities.attachFiles && e.clipboardData.files.length) {
                e.preventDefault();
                attachments.add(Array.from(e.clipboardData.files));
              }
            }}
          >
            {voice.panel}
            <AttachmentTray value={attachments} />
            <label className="sr-only" htmlFor="composer">
              Instruction
            </label>
            <TextArea
              id="composer"
              ref={composer}
              rows={1}
              onInput={(e) => {
                e.currentTarget.style.height = 'auto';
                e.currentTarget.style.height = `${Math.min(e.currentTarget.scrollHeight, 160)}px`;
              }}
              placeholder={
                session.status === 'working' || pending.length
                  ? 'What should happen next?'
                  : 'Message your agent…'
              }
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') submit(e);
              }}
            />
            <div className="composer-controls">
              {session.capabilities.attachFiles && (
                <AttachmentPicker disabled={attachments.files.length >= 10} add={attachments.add} />
              )}
              <div className="composer-mode">
                <Layers size={16} aria-hidden="true" />
                <label className="sr-only" htmlFor="mode">
                  Instruction behavior
                </label>
                <select id="mode" value={behavior} onChange={(e) => setBehavior(e.target.value)}>
                  <option value="auto">
                    {mode === 'steer' ? 'Steer active turn' : 'Send message'}
                  </option>
                  <option value="queue">Queue for later</option>
                </select>
              </div>
              {voice.button}
              <button
                className="send-button"
                type="submit"
                disabled={
                  (!draft.trim() && !attachments.files.length) ||
                  voice.busy ||
                  attachments.busy ||
                  attachments.invalid ||
                  busyWithoutSteering ||
                  send.isPending ||
                  !session.connected
                }
                aria-label={
                  mode === 'steer'
                    ? 'Steer active turn'
                    : mode === 'queue'
                      ? 'Queue instruction'
                      : 'Send message'
                }
              >
                <span className="sr-only">
                  {send.isPending
                    ? 'Sending…'
                    : mode === 'steer'
                      ? 'Steer'
                      : mode === 'queue'
                        ? 'Queue'
                        : 'Send'}
                </span>
                <ArrowUp size={22} aria-hidden="true" />
              </button>
            </div>
          </form>
        ) : (
          <div className="readonly-note">
            <Info size={18} aria-hidden="true" />
            <span>
              {session.diagnostic ||
                'Waiting for a verified agent connection before sending messages.'}
              {pending.length > 0 ? ' Pending approvals can be answered above.' : ''}
            </span>
          </div>
        )}
        {send.error && (
          <p className="error" role="alert">
            {send.error.message}
          </p>
        )}
        <p className="composer-footer" role="status">
          {pending.length > 0
            ? 'Answer the question above to continue.'
            : busyWithoutSteering
              ? 'This agent cannot be steered yet. Choose Queue to schedule a follow-up.'
              : (send.isPending
                  ? send.variables?.mode === 'steer'
                    ? 'Sending to the active turn…'
                    : 'Sending your instruction…'
                  : '') ||
                receiptStatus ||
                notice ||
                (!session.capabilities.queueTask
                  ? 'Chat control is waiting for a verified connection.'
                  : '')}
        </p>
      </div>
    </MediaPreviewProvider>
  );
}
function WorkingIndicator({ harness, events }: { harness: string; events: Event[] }) {
  const latest = [...events]
    .reverse()
    .find(
      (e) =>
        !e.data.nativeMeta &&
        [
          'tool.invocation',
          'tool.output',
          'tool.completion',
          'assistant.delta',
          'assistant.message',
        ].includes(e.kind),
    );
  const detail =
    latest?.kind === 'tool.invocation'
      ? `Using ${String(latest.data.tool ?? 'a tool')}`
      : latest?.kind === 'assistant.delta'
        ? 'Writing a response'
        : 'Working on your request';
  return (
    <div className="working-indicator" role="status" aria-label={`${harness} is working`}>
      <span className="working-dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <span>
        <strong>{harness} is working</strong>
        <span className="working-detail">{detail}</span>
      </span>
    </div>
  );
}
function conversationItems(events: Event[]): Event[] {
  const replaced = new Set(
    events.flatMap((e) =>
      Array.isArray(e.data.replacesEventSourceIds) ? e.data.replacesEventSourceIds : [],
    ),
  );
  events = events.filter((e) => !replaced.has(e.sourceId));
  const completed = new Set(
    events.filter((e) => e.kind === 'assistant.message' && e.data.itemId).map((e) => e.data.itemId),
  );
  const deltas = new Map<unknown, Event>();
  const output: Event[] = [];
  for (const e of events) {
    if (e.data.nativeMeta) continue;
    if (e.kind === 'assistant.delta') {
      const key = e.data.itemId;
      if (completed.has(key)) continue;
      const existing = deltas.get(key);
      if (existing) existing.data.text = String(existing.data.text) + String(e.data.text);
      else {
        const item = { ...e, data: { ...e.data } };
        deltas.set(key, item);
        output.push(item);
      }
    } else if (
      ![
        'turn.started',
        'turn.completed',
        'task.queued',
        'task.dispatched',
        'task.completed',
        'connection.state',
        'agent.status',
        'question',
        'approval.request',
        'approval.response',
      ].includes(e.kind)
    )
      output.push(e);
  }
  const grouped: Event[] = [];
  for (const event of output) {
    const previous = grouped[grouped.length - 1];
    if (event.kind.startsWith('tool.') || event.kind === 'reasoning.summary') {
      if (previous?.data.activityGroup) (previous.data.activities as Event[]).push(event);
      else grouped.push({ ...event, data: { activityGroup: true, activities: [event] } });
    } else grouped.push(event);
  }
  return grouped;
}
function EventCard({ event }: { event: Event }) {
  const data = event.data;
  const nativeText = String(data.text ?? '');
  const presentation =
    event.kind === 'user.message' ? presentUserMessage(nativeText) : { text: nativeText };
  const text = presentation.text;
  const [copyError, setCopyError] = useState('');
  const [copied, setCopied] = useState(false);
  if (event.kind === 'artifact.created')
    return (
      <article className="artifact-card" aria-label="Generated artifact">
        <h3>{String(data.title ?? 'Generated file')}</h3>
        {text && <Mark text={text} />}
        {Array.isArray(data.nativeFiles) && <NativeMediaGallery event={event} />}
        <div className="artifact-files">
          {Array.isArray(data.attachments) &&
            (data.attachments as { id: string; name: string; mime?: string }[]).map((file) => (
              <SentAttachment artifact key={file.id} sessionId={event.sessionId} file={file} />
            ))}
        </div>
      </article>
    );
  if (presentation.activity) {
    const activity = presentation.activity;
    return (
      <details className="native-activity">
        <summary>
          <ChevronRight size={18} aria-hidden="true" />
          <span>
            <strong>{activity.title}</strong>
            <span className="native-activity-preview">{activity.summary}</span>
          </span>
        </summary>
        <div className="native-activity-body">
          <p>{activity.summary}</p>
          {activity.details.length > 0 && (
            <dl>
              {activity.details.map(({ label, value }) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      </details>
    );
  }
  if (data.activityGroup) {
    const activities = data.activities as Event[];
    const calls = activities.filter((e) => e.kind === 'tool.invocation');
    const names = [...new Set(calls.map((e) => toolLabel(String(e.data.tool ?? 'Tool'))))];
    return (
      <details className="activity-group">
        <summary>
          <ChevronRight size={16} aria-hidden="true" />
          <span>
            {calls.length
              ? `${calls.length} ${calls.length === 1 ? 'action' : 'actions'}`
              : 'Agent activity'}
            {names.length ? ` · ${names.slice(0, 3).join(', ')}` : ''}
          </span>
        </summary>
        {activities.map((e) => (
          <EventCard key={e.id} event={e} />
        ))}
      </details>
    );
  }
  if (['user.message', 'assistant.message', 'assistant.delta'].includes(event.kind))
    return (
      <article
        className={`message ${event.kind === 'user.message' ? 'user-message' : 'assistant-message'}`}
      >
        <div className="message-author">
          {event.kind === 'user.message' ? 'You' : 'Agent'}
          {event.kind === 'assistant.delta' && <span className="streaming-label">Writing…</span>}
        </div>
        <div className="message-content">
          {presentation.replies?.map((reply, index) => (
            <div className="reply-context" key={index}>
              <span>Replying to</span>
              <p>{reply.question}</p>
            </div>
          ))}
          {presentation.command && <div className="message-command">{presentation.command}</div>}
          <Mark text={text} event={event} />
          {Array.isArray(data.attachments) && (
            <div className="sent-attachments">
              {(data.attachments as { id: string; name: string; mime?: string }[]).map((file) => (
                <SentAttachment key={file.id} sessionId={event.sessionId} file={file} />
              ))}
            </div>
          )}
        </div>
        <div className="message-actions">
          <button
            type="button"
            aria-label="Copy message"
            onClick={() =>
              void navigator.clipboard
                .writeText([presentation.command, text].filter(Boolean).join('\n'))
                .then(() => {
                  setCopyError('');
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                })
                .catch(() => setCopyError('Copy unavailable. Select the message text to copy it.'))
            }
          >
            <Copy size={15} />
            {copied ? 'Copied' : 'Copy'}
          </button>
          {copyError && <span role="status">{copyError}</span>}
          <time dateTime={event.timestamp}>
            {new Date(event.timestamp).toLocaleTimeString([], {
              hour: 'numeric',
              minute: '2-digit',
            })}
          </time>
        </div>
      </article>
    );
  if (event.kind.startsWith('tool.') || event.kind === 'file.change' || event.kind === 'diff')
    return (
      <div className="tool-wrap">
        <details className="tool-card">
          <summary>
            <span className="tool-icon" aria-hidden="true">
              {event.kind === 'tool.completion' ? <Check size={16} /> : <ChevronRight size={16} />}
            </span>
            <span>
              {String(
                data.tool ??
                  (event.kind === 'diff'
                    ? 'Review diff'
                    : event.kind === 'file.change'
                      ? 'File changes'
                      : 'Tool output'),
              )}
            </span>
            <span className="tool-state">{event.kind.split('.')[1]}</span>
          </summary>
          <pre>{text || JSON.stringify(data, null, 2)}</pre>
        </details>
      </div>
    );
  if (event.kind === 'reasoning.summary')
    return (
      <div className="tool-wrap">
        <details className="tool-card">
          <summary>Reasoning summary</summary>
          {presentation.replies?.map((reply, index) => (
            <div className="reply-context" key={index}>
              <span>Replying to</span>
              <p>{reply.question}</p>
            </div>
          ))}
          <Mark text={text} />
        </details>
      </div>
    );
  if (event.kind === 'plan')
    return (
      <div className="plan-card">
        <h3>Plan</h3>
        <Mark text={text} />
        <pre>{JSON.stringify(data.steps, null, 2)}</pre>
      </div>
    );
  return (
    <p className={`timeline-event ${event.kind === 'turn.failed' ? 'error' : ''}`}>
      <span aria-hidden="true" className="timeline-dot" />
      {text || event.kind.replaceAll('.', ' ')}
      {event.kind === 'turn.failed' && data.error ? `: ${JSON.stringify(data.error)}` : ''}
    </p>
  );
}
function InteractionCard({
  interaction: i,
  canRespond,
}: {
  interaction: Interaction;
  canRespond: boolean;
}) {
  const query = useQueryClient();
  const [answer, setAnswer] = useState('');
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [multiple, setMultiple] = useState<string[]>([]);
  const questions = i.metadata.questions as
    | { id: string; question: string; options?: { label: string; description: string }[] }[]
    | undefined;
  const mutation = useMutation({
    mutationFn: (response: unknown) =>
      api(`/api/interactions/${i.id}/respond`, {
        method: 'POST',
        body: JSON.stringify({ response }),
      }),
    onSuccess: () => void query.invalidateQueries({ queryKey: ['detail', i.sessionId] }),
  });
  const active = canRespond && i.status === 'pending' && Date.parse(i.expiresAt) > Date.now();
  const approval = i.type.endsWith('approval');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const response = questions
      ? {
          answers: Object.fromEntries(
            questions.map((q) => [q.id, { answers: [answers[q.id] ?? ''] }]),
          ),
        }
      : i.type === 'multiple-choice'
        ? multiple
        : answer;
    mutation.mutate(response);
  };
  return (
    <section
      id={`interaction-${i.id}`}
      className={`interaction-card ${!active ? 'inactive' : ''}`}
      aria-labelledby={`question-${i.id}`}
    >
      <div className="interaction-label">
        <ShieldCheck size={18} aria-hidden="true" />
        {approval ? 'Permission request' : 'Your input is needed'}
        <span>{active ? 'Pending' : i.status}</span>
      </div>
      <h3 id={`question-${i.id}`}>{i.prompt}</h3>
      {!!(i.metadata.input || i.metadata.command) && (
        <pre className="approval-preview">
          {typeof i.metadata.command === 'string'
            ? i.metadata.command
            : JSON.stringify(i.metadata.input, null, 2)}
        </pre>
      )}
      {i.route === 'dsh-native' ? (
        <DshQuestions
          questions={i.metadata.dshQuestions as any}
          disabled={!active}
          submitting={mutation.isPending}
          submit={(response) => mutation.mutate(response)}
        />
      ) : approval ? (
        <div className="approval-actions">
          {i.choices.map((c) => (
            <button
              key={c.id}
              className={['allow', 'accept'].includes(c.id) ? 'primary' : 'secondary'}
              disabled={!active || mutation.isPending}
              onClick={() => mutation.mutate(c.id)}
            >
              {mutation.isPending ? 'Submitting…' : c.label}
            </button>
          ))}
        </div>
      ) : (
        <form onSubmit={submit}>
          {questions ? (
            questions.map((q) => (
              <fieldset key={q.id}>
                <legend>{q.question}</legend>
                {q.options?.map((o) => (
                  <label className="choice" key={o.label}>
                    <input
                      type="radio"
                      name={`${i.id}-${q.id}`}
                      value={o.label}
                      checked={answers[q.id] === o.label}
                      disabled={!active}
                      onChange={() => setAnswers((old) => ({ ...old, [q.id]: o.label }))}
                    />
                    <span>
                      {o.label}
                      <small>{o.description}</small>
                    </span>
                  </label>
                ))}
                <label>
                  Response
                  <input
                    value={answers[q.id] ?? ''}
                    onChange={(e) => setAnswers((old) => ({ ...old, [q.id]: e.target.value }))}
                    required
                    disabled={!active}
                  />
                </label>
              </fieldset>
            ))
          ) : i.choices.length ? (
            <fieldset>
              <legend className="sr-only">Choose a response</legend>
              {i.choices.map((c) => (
                <label className="choice" key={c.id}>
                  <input
                    type={i.type === 'multiple-choice' ? 'checkbox' : 'radio'}
                    name={i.id}
                    checked={
                      i.type === 'multiple-choice' ? multiple.includes(c.id) : answer === c.id
                    }
                    onChange={() =>
                      i.type === 'multiple-choice'
                        ? setMultiple((old) =>
                            old.includes(c.id) ? old.filter((v) => v !== c.id) : [...old, c.id],
                          )
                        : setAnswer(c.id)
                    }
                    disabled={!active}
                  />
                  {c.label}
                </label>
              ))}
            </fieldset>
          ) : (
            <label>
              Your response
              <textarea
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                required
                disabled={!active}
              />
            </label>
          )}
          <button
            className="primary"
            disabled={
              !active || mutation.isPending || (!questions && !answer && multiple.length === 0)
            }
          >
            {mutation.isPending ? 'Submitting…' : 'Send response'}
          </button>
        </form>
      )}
      {mutation.error && (
        <p className="error" role="alert">
          {mutation.error.message}
        </p>
      )}
      <p className="helper">
        {active
          ? 'This resolves this request only. It does not start another turn.'
          : 'This request is no longer available. Check the agent’s latest state.'}
      </p>
    </section>
  );
}
function QueueView({ session, tasks }: { session: SessionView; tasks: Task[] }) {
  const query = useQueryClient();
  const [editing, setEditing] = useState<Task>();
  const [prompt, setPrompt] = useState('');
  const mutation = useMutation({
    mutationFn: ({
      url,
      method = 'POST',
      body,
    }: {
      url: string;
      method?: string;
      body?: unknown;
    }) => api(url, { method, body: body === undefined ? undefined : JSON.stringify(body) }),
    onSuccess: () => {
      setEditing(undefined);
      void query.invalidateQueries({ queryKey: ['detail', session.id] });
    },
  });
  const base = `/api/sessions/${session.id}`;
  const pending = tasks.filter((t) => t.status === 'pending');
  const reorder = (id: string, direction: number) => {
    const ids = pending.map((t) => t.id);
    const index = ids.indexOf(id);
    const target = index + direction;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    mutation.mutate({ url: `${base}/queue`, body: { order: ids } });
  };
  return (
    <div className="page-content">
      <div className="section-intro">
        <div>
          <h3>Next in line</h3>
          <p>Tasks run one at a time after the agent is ready and pending requests are resolved.</p>
        </div>
        {session.capabilities.queueTask && (
          <button
            className="secondary"
            disabled={mutation.isPending}
            onClick={() =>
              mutation.mutate({ url: `${base}/queue`, body: { paused: !session.queuePaused } })
            }
          >
            {session.queuePaused ? <Play size={17} /> : <Pause size={17} />}{' '}
            {session.queuePaused ? 'Resume' : 'Pause'}
          </button>
        )}
      </div>
      {session.queuePaused && (
        <p className="connection-banner">Dispatch is paused. Pending work stays saved.</p>
      )}
      {tasks.length === 0 && (
        <Empty title="Nothing queued">
          Add an instruction from the conversation. It stays saved even if this device disconnects.
        </Empty>
      )}
      {tasks.map((t, index) => (
        <article className="task-card" key={t.id}>
          <div className="task-heading">
            <span className="task-number">{index + 1}</span>
            <span className={`task-status ${t.status}`}>{t.status}</span>
            <time>{when(t.createdAt)}</time>
          </div>
          <p>{t.prompt}</p>
          {t.error && <p className="error">{t.error}</p>}
          {t.status === 'pending' && session.capabilities.queueTask && (
            <div className="task-actions">
              <button
                onClick={() => {
                  setEditing(t);
                  setPrompt(t.prompt);
                }}
              >
                Edit
              </button>
              <IconButton
                label="Move task up"
                disabled={pending[0]?.id === t.id || mutation.isPending}
                onClick={() => reorder(t.id, -1)}
              >
                <ArrowUp size={18} />
              </IconButton>
              <IconButton
                label="Move task down"
                disabled={pending.at(-1)?.id === t.id || mutation.isPending}
                onClick={() => reorder(t.id, 1)}
              >
                <ArrowDown size={18} />
              </IconButton>
              <button
                className="danger-text"
                disabled={mutation.isPending}
                onClick={() => mutation.mutate({ url: `${base}/tasks/${t.id}`, method: 'DELETE' })}
              >
                Cancel task
              </button>
            </div>
          )}
        </article>
      ))}
      {mutation.error && (
        <p role="alert" className="error">
          {mutation.error.message}
        </p>
      )}
      {editing && (
        <Dialog title="Edit queued task" close={() => setEditing(undefined)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              mutation.mutate({
                url: `${base}/tasks/${editing.id}`,
                method: 'PATCH',
                body: { prompt },
              });
            }}
          >
            <label>
              Instruction
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={5}
                required
              />
            </label>
            <button className="primary" disabled={mutation.isPending}>
              Save task
            </button>
          </form>
        </Dialog>
      )}
    </div>
  );
}
function Dialog({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog ref={ref} onCancel={close} className="dialog">
      <header>
        <h2>{title}</h2>
        <IconButton label="Close dialog" onClick={close}>
          <X size={22} />
        </IconButton>
      </header>
      {children}
    </dialog>
  );
}
function SessionDetails({ session: s }: { session: SessionView }) {
  const mutation = useMutation({
    mutationFn: () =>
      api(`/api/sessions/${s.id}/interrupt`, {
        method: 'POST',
        body: JSON.stringify({ confirm: true }),
      }),
  });
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="page-content">
      <h3>{s.project}</h3>
      {isSaved(s) ? (
        <span className="saved-session-label">Saved session</span>
      ) : (
        <Status status={s.status} />
      )}
      {s.harness === 'dsh' && s.capabilities.sendMessage && <DshModel session={s} />}
      <dl className="details-list">
        {[
          ['Agent', s.harness],
          ...(s.agentPreset ? [['Agent profile', s.agentPreset]] : []),
          ['Model', s.model || 'Model unknown'],
          ['Host', s.hostId],
          ['Workspace', s.workspaceId],
          ['Working directory', s.cwd],
          ['Connection', s.connected ? 'Connected' : 'Disconnected'],
          [
            'Control mode',
            s.harness === 'dsh'
              ? 'Existing DSH web session'
              : s.ownership === 'gateway-native'
                ? 'Native bridge'
                : s.ownership === 'herdr-cli'
                  ? 'Existing Herdr session'
                  : 'Observation',
          ],
          ['Native session', s.nativeSessionId],
        ].map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {s.diagnostic && (
        <p className="diagnostic">
          <Info size={18} aria-hidden="true" />
          {s.diagnostic}
        </p>
      )}
      <h3>Available actions</h3>
      <ul className="capability-list">
        {Object.entries(s.capabilities)
          .filter(([, v]) => v)
          .map(([key]) => (
            <li key={key}>
              <Check size={17} aria-hidden="true" />
              {key.replace(/([A-Z])/g, ' $1').toLowerCase()}
            </li>
          ))}
      </ul>
      {s.capabilities.interruptTurn && (
        <button className="danger" onClick={() => setConfirm(true)}>
          Interrupt active turn
        </button>
      )}
      {confirm && (
        <Dialog title="Interrupt this turn?" close={() => setConfirm(false)}>
          <p>The agent will stop its current work. Pending queued tasks remain saved.</p>
          <button
            className="danger"
            disabled={mutation.isPending}
            onClick={() => mutation.mutate(undefined, { onSuccess: () => setConfirm(false) })}
          >
            Interrupt turn
          </button>
          {mutation.error && (
            <p className="error" role="alert">
              {mutation.error.message}
            </p>
          )}
        </Dialog>
      )}
    </div>
  );
}
function Attention({
  sessions,
  navigate,
}: {
  sessions: SessionView[];
  navigate: (route: Route) => void;
}) {
  return (
    <>
      <PageHeader title="Needs attention" back={() => navigate({})} />
      <div className="page-content">
        {sessions
          .filter((s) => s.pendingCount > 0)
          .map((s) => (
            <button
              key={s.id}
              className="attention-session"
              onClick={() => navigate({ session: s.id })}
            >
              <CircleHelp size={24} aria-hidden="true" />
              <span>
                <strong>{s.project}</strong>
                <small>
                  {s.pendingCount} request{s.pendingCount > 1 ? 's' : ''} waiting · {s.harness}
                </small>
              </span>
              <ChevronRight aria-hidden="true" />
            </button>
          ))}
        {!sessions.some((s) => s.pendingCount > 0) && (
          <Empty title="You’re all caught up">
            Questions and approvals appear here when an agent needs you.
          </Empty>
        )}
      </div>
    </>
  );
}
function SettingsView({ admin, back }: { admin: boolean; back: () => void }) {
  const query = useQueryClient();
  const hosts = useQuery({
    queryKey: ['hosts'],
    queryFn: () => api('/api/hosts'),
    refetchInterval: 5000,
  });
  const devices = useQuery({ queryKey: ['devices'], queryFn: () => api('/api/devices') });
  const sessions = useQuery<{ sessions: SessionView[] }>({
    queryKey: ['sessions'],
    queryFn: () => api('/api/sessions'),
  });
  const [pairing, setPairing] = useState('');
  const [notifications, setNotifications] = useState(
    localStorage.getItem('relay-notifications') === 'on',
  );
  const [theme, setTheme] = useState(localStorage.getItem('relay-theme') ?? 'system');
  const [revoke, setRevoke] = useState<string>();
  const mutation = useMutation({
    mutationFn: ({ url, method, body }: { url: string; method: string; body?: unknown }) =>
      api(url, { method, body: body ? JSON.stringify(body) : undefined }),
    onSuccess: () => void query.invalidateQueries({ queryKey: ['devices'] }),
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('relay-theme', theme);
  }, [theme]);
  const enableNotifications = async () => {
    if (!('Notification' in window)) return;
    const permission = await Notification.requestPermission();
    const enabled = permission === 'granted';
    setNotifications(enabled);
    localStorage.setItem('relay-notifications', enabled ? 'on' : 'off');
  };
  return (
    <>
      <PageHeader title="Settings" back={back} />
      <div className="page-content settings-content">
        <section>
          <h3>Hosts & connection</h3>
          <p>Your gateway discovers existing Herdr sessions automatically.</p>
          {hosts.data?.hosts.map((h: any) => (
            <div className="host-row" key={h.id}>
              {h.connected ? (
                <Wifi size={20} aria-hidden="true" />
              ) : (
                <WifiOff size={20} aria-hidden="true" />
              )}
              <div>
                <strong>{h.name}</strong>
                <small>
                  {h.connected ? 'Connected' : 'Disconnected'}
                  {h.version ? ` · Herdr ${h.version}` : ''}
                </small>
                {h.diagnostic && <p className="error">{h.diagnostic}</p>}
              </div>
            </div>
          ))}
          <p className="helper">
            Hosts are configured on the gateway. Use your private HTTPS address when connecting from
            your phone.
          </p>
        </section>
        <section>
          <h3>Appearance</h3>
          <label>
            Theme
            <select aria-label="Theme" value={theme} onChange={(e) => setTheme(e.target.value)}>
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </label>
        </section>
        <InstallApp />
        <section>
          <h3>Notifications</h3>
          <p>Get a notification when an agent needs input, a task completes, or a session fails.</p>
          <button
            className="secondary"
            onClick={() =>
              notifications
                ? (setNotifications(false), localStorage.setItem('relay-notifications', 'off'))
                : void enableNotifications()
            }
          >
            {notifications ? 'Turn notifications off' : 'Enable browser notifications'}
          </button>
          <p className="helper">
            Available while Relay is open and your browser permits notifications. Closed-app push
            delivery is not implemented.
          </p>
        </section>
        <section>
          <h3>Devices & permissions</h3>
          {admin && (
            <button
              className="secondary"
              onClick={() =>
                mutation.mutate(
                  { url: '/api/devices/pairing', method: 'POST' },
                  { onSuccess: (data) => setPairing(data.key) },
                )
              }
            >
              Create pairing key
            </button>
          )}
          {pairing && (
            <div className="pair-key">
              <p>One use. Expires in 5 minutes.</p>
              <input aria-label="New device pairing key" value={pairing} readOnly />
              <button
                onClick={() => {
                  void navigator.clipboard.writeText(pairing);
                }}
              >
                Copy key
              </button>
            </div>
          )}
          {devices.data?.devices.map((d: any) => (
            <div className="device-row" key={d.id}>
              <div>
                <strong>{d.name}</strong>
                <small>
                  {d.revoked ? 'Revoked' : d.admin ? 'Administrator' : 'Registered device'}
                </small>
                {admin &&
                  !d.admin &&
                  !d.revoked &&
                  sessions.data?.sessions.map((s) => (
                    <label className="grant-row" key={s.id}>
                      {s.project}
                      <select
                        aria-label={`Permission for ${d.name} on ${s.project}`}
                        value={
                          devices.data.grants?.find(
                            (g: any) => g.device_id === d.id && g.session_id === s.id,
                          )?.control === 1
                            ? 'control'
                            : devices.data.grants?.some(
                                  (g: any) => g.device_id === d.id && g.session_id === s.id,
                                )
                              ? 'read'
                              : 'none'
                        }
                        onChange={(e) => {
                          if (e.target.value !== 'none')
                            mutation.mutate({
                              url: `/api/devices/${d.id}/grants/${s.id}`,
                              method: 'PUT',
                              body: { control: e.target.value === 'control' },
                            });
                        }}
                      >
                        <option value="none" disabled>
                          No access
                        </option>
                        <option value="read">Read only</option>
                        <option value="control">Read & control</option>
                      </select>
                    </label>
                  ))}
              </div>
              {!d.revoked && (
                <button className="danger-text" onClick={() => setRevoke(d.id)}>
                  Revoke
                </button>
              )}
            </div>
          ))}
        </section>
        {mutation.error && (
          <p className="error" role="alert">
            {mutation.error.message}
          </p>
        )}
        <button
          className="secondary"
          onClick={() =>
            void api('/api/auth/logout', { method: 'POST' }).then(() => location.reload())
          }
        >
          Sign out
        </button>
        {revoke && (
          <Dialog title="Revoke this device?" close={() => setRevoke(undefined)}>
            <p>This device will lose access immediately.</p>
            <button
              className="danger"
              onClick={() =>
                mutation.mutate(
                  { url: `/api/devices/${revoke}`, method: 'DELETE' },
                  { onSuccess: () => setRevoke(undefined) },
                )
              }
            >
              Revoke device
            </button>
          </Dialog>
        )}
      </div>
    </>
  );
}
