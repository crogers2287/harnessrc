import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@harnessrc/client-sdk';
import type { Event } from '@harnessrc/protocol';
import { conversationItems } from './conversation-items.ts';
import { agentStatus, useAgentCatalog } from './ConversationNavigation.tsx';

const positions = new Map<string, number>();
const histories = new Map<string, Event[]>();
const isActivity = (event: Event) =>
  !['user.message', 'assistant.message', 'assistant.delta', 'artifact.created'].includes(
    event.kind,
  );
export function Subagents({
  sessionId,
  childId,
  activity = false,
  select,
  renderEvent,
}: {
  sessionId: string;
  childId?: string;
  activity?: boolean;
  select: (id: string) => void;
  renderEvent: (event: Event) => React.ReactNode;
}) {
  const catalog = useAgentCatalog(sessionId);
  const child = catalog.data?.subagents.find((a) => a.id === childId);
  if (!childId)
    return (
      <section className="subagent-view agent-catalog">
        <h2>Sub-agent conversations</h2>
        <p className="muted">
          Open an agent’s work without losing your place in the main conversation.
        </p>
        {catalog.isPending && <p role="status">Finding sub-agents…</p>}
        {catalog.error && <p role="alert">{catalog.error.message}</p>}
        {catalog.data && !catalog.data.supported && (
          <p>This harness does not expose linked sub-agent conversations to Relay yet.</p>
        )}
        {catalog.data?.supported && !catalog.data.subagents.length && (
          <p>No linked sub-agents recorded yet.</p>
        )}
        {catalog.data?.subagents.map((a) => (
          <button className="subagent-row" key={a.id} onClick={() => select(a.id)}>
            <strong>{a.name}</strong>
            <span>
              {agentStatus(a.status)} · {a.model || 'Model not reported'}
            </span>
            <time>{new Date(a.updatedAt).toLocaleString()}</time>
          </button>
        ))}
      </section>
    );
  return (
    <AgentTranscript
      key={`${sessionId}:${childId}:${activity}`}
      sessionId={sessionId}
      childId={childId}
      activity={activity}
      name={child?.name}
      model={child?.model}
      renderEvent={renderEvent}
    />
  );
}
function AgentTranscript({
  sessionId,
  childId,
  activity,
  name,
  model,
  renderEvent,
}: {
  sessionId: string;
  childId: string;
  activity: boolean;
  name?: string;
  model?: string;
  renderEvent: (event: Event) => React.ReactNode;
}) {
  const historyKey = `${sessionId}:${childId}`;
  const [history, setHistory] = useState<Event[]>(() => histories.get(historyKey) ?? []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [more, setMore] = useState(true);
  const scroll = useRef<HTMLDivElement>(null);
  const restored = useRef(false);
  const following = useRef(true);
  const [latest, setLatest] = useState(false);
  const key = `${sessionId}:${childId}:${activity}`;
  const transcript = useQuery({
    queryKey: ['subagent-events', sessionId, childId],
    queryFn: () =>
      api<{ events: Event[] }>(`/api/sessions/${sessionId}/subagents/${childId}/events?limit=100`),
    refetchInterval: 3000,
  });
  useEffect(() => {
    if (transcript.data)
      setHistory((old) => [
        ...new Map([...old, ...transcript.data!.events].map((e) => [e.id, e])).values(),
      ]);
  }, [transcript.data]);
  useEffect(() => {
    if (histories.size >= 32 && !histories.has(historyKey))
      histories.delete(histories.keys().next().value!);
    histories.set(historyKey, history);
  }, [history, historyKey]);
  const events = [
    ...new Map([...history, ...(transcript.data?.events ?? [])].map((e) => [e.id, e])).values(),
  ].sort((a, b) => a.sequence - b.sequence);
  useLayoutEffect(() => {
    if (!transcript.data || restored.current || !scroll.current) return;
    following.current = !positions.has(key);
    scroll.current.scrollTop = positions.get(key) ?? scroll.current.scrollHeight;
    setLatest(!following.current);
    restored.current = true;
  }, [transcript.data, key]);
  useLayoutEffect(() => {
    if (following.current && restored.current && scroll.current)
      scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [events.length, events.at(-1)?.data.text]);
  const earlier = async () => {
    setLoading(true);
    following.current = false;
    setLatest(true);
    setError('');
    const pane = scroll.current;
    const height = pane?.scrollHeight ?? 0;
    const top = pane?.scrollTop ?? 0;
    try {
      const result = await api<{ events: Event[] }>(
        `/api/sessions/${sessionId}/subagents/${childId}/events?before=${events[0]?.sequence}&limit=100`,
      );
      setHistory((old) => [...result.events, ...old]);
      setMore(result.events.length === 100);
      requestAnimationFrame(() => {
        if (pane) pane.scrollTop = top + pane.scrollHeight - height;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load history');
    } finally {
      setLoading(false);
    }
  };
  const visible = conversationItems(events, 'grouped').filter((e) =>
    activity ? isActivity(e) : !isActivity(e),
  );
  return (
    <>
      <div className="agent-readonly">
        <span>{name || 'Sub-agent conversation'}</span>
        <span>View only · {model || 'Model not reported'}</span>
      </div>
      <div
        className="agent-transcript conversation-scroll"
        ref={scroll}
        onPointerDown={() => {
          following.current = false;
          setLatest(true);
        }}
        onWheel={() => {
          following.current = false;
          setLatest(true);
        }}
        onScroll={() => {
          if (scroll.current) positions.set(key, scroll.current.scrollTop);
        }}
      >
        {more && events[0]?.sequence > 1 && (
          <button className="load-older" disabled={loading} onClick={() => void earlier()}>
            {loading ? 'Loading…' : 'Load earlier messages'}
          </button>
        )}
        {(transcript.error || error) && (
          <div role="alert">
            <p>{error || transcript.error?.message}</p>
            <button onClick={() => void transcript.refetch()}>Retry</button>
          </div>
        )}
        {transcript.isPending && <p role="status">Loading conversation…</p>}
        {!transcript.isPending && !transcript.error && !visible.length && (
          <p>{activity ? 'No activity recorded yet.' : 'No conversation recorded yet.'}</p>
        )}
        <div className="transcript">
          {visible.map((e) => (
            <div key={e.id}>{renderEvent(e)}</div>
          ))}
        </div>
      </div>
      {latest && (
        <button
          className="agent-jump-latest"
          onClick={() => {
            following.current = true;
            setLatest(false);
            if (scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
          }}
        >
          Latest messages
        </button>
      )}
      <div className="agent-readonly-footer">
        The parent agent controls this work. Return to Main conversation to send a message.
      </div>
    </>
  );
}
