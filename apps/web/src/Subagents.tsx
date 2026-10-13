import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@harnessrc/client-sdk';
import type { Event } from '@harnessrc/protocol';
import type { Subagent } from '../../../packages/adapters/src/subagents.ts';

export function Subagents({
  sessionId,
  renderEvent,
}: {
  sessionId: string;
  renderEvent: (event: Event) => React.ReactNode;
}) {
  const [child, setChild] = useState<Subagent>();
  const [older, setOlder] = useState<Event[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const catalog = useQuery({
    queryKey: ['subagents', sessionId],
    queryFn: () =>
      api<{ supported: boolean; subagents: Subagent[] }>(`/api/sessions/${sessionId}/subagents`),
    refetchInterval: 15000,
  });
  const transcript = useQuery({
    queryKey: ['subagent-events', sessionId, child?.id],
    enabled: !!child,
    queryFn: () =>
      api<{ events: Event[] }>(
        `/api/sessions/${sessionId}/subagents/${child!.id}/events?limit=100`,
      ),
    refetchInterval: 3000,
  });
  const events = [
    ...new Map([...older, ...(transcript.data?.events ?? [])].map((e) => [e.id, e])).values(),
  ].sort((a, b) => a.sequence - b.sequence);
  const earlier = async () => {
    setLoading(true);
    setError('');
    try {
      const result = await api<{ events: Event[] }>(
        `/api/sessions/${sessionId}/subagents/${child!.id}/events?before=${events[0]?.sequence}&limit=100`,
      );
      setOlder((old) => [...result.events, ...old]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load history');
    } finally {
      setLoading(false);
    }
  };
  return (
    <section className="subagent-view">
      {child ? (
        <>
          <button
            className="secondary"
            onClick={() => {
              setChild(undefined);
              setOlder([]);
              setError('');
            }}
          >
            All sub-agents
          </button>
          <h2>{child.name}</h2>
          <p className="muted">View only · {child.model || 'Model not reported'}</p>
          {events[0]?.sequence > 1 && (
            <button className="secondary" disabled={loading} onClick={() => void earlier()}>
              Load earlier messages
            </button>
          )}
          {(transcript.error || error) && <p role="alert">{error || transcript.error?.message}</p>}
          {transcript.isPending && <p role="status">Loading conversation…</p>}
          {!transcript.isPending && !events.length && <p>No conversation recorded yet.</p>}
          {events.map((event) => (
            <div key={event.id}>{renderEvent(event)}</div>
          ))}
        </>
      ) : (
        <>
          <p className="muted">
            Conversations spawned by this session. View only; the parent agent controls their work.
          </p>
          {catalog.isPending && <p role="status">Finding sub-agents…</p>}
          {catalog.error && <p role="alert">{catalog.error.message}</p>}
          {catalog.data && !catalog.data.supported && (
            <p>This harness does not expose linked sub-agent conversations to Relay yet.</p>
          )}
          {catalog.data?.supported && !catalog.data.subagents.length && (
            <p>No linked sub-agents recorded yet.</p>
          )}
          {catalog.data?.subagents.map((agent) => (
            <button className="subagent-row" key={agent.id} onClick={() => setChild(agent)}>
              <strong>{agent.name}</strong>
              <span>{agent.model || 'Model not reported'} · View only</span>
              <time>{new Date(agent.updatedAt).toLocaleString()}</time>
            </button>
          ))}
        </>
      )}
    </section>
  );
}
