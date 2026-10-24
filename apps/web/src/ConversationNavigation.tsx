import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@harnessrc/client-sdk';
import { Check, ChevronDown, GitBranch, MessageSquare, X } from 'lucide-react';
import type { Subagent } from '../../../packages/adapters/src/subagents.ts';

export type AgentCatalog = { supported: boolean; subagents: Subagent[] };
export function useAgentCatalog(sessionId: string) {
  return useQuery({
    queryKey: ['subagents', sessionId],
    queryFn: () => api<AgentCatalog>(`/api/sessions/${sessionId}/subagents`),
    refetchInterval: 5000,
  });
}
export function agentStatus(status: string) {
  return (
    (
      {
        working: 'Working',
        blocked: 'Waiting',
        idle: 'Ready',
        done: 'Finished',
        offline: 'Offline',
        ended: 'Ended',
      } as Record<string, string>
    )[status] ?? 'Recorded'
  );
}
export function ConversationNavigation({
  sessionId,
  title,
  agentId,
  activity,
  select,
  tab,
}: {
  sessionId: string;
  title: string;
  agentId?: string;
  activity: boolean;
  select: (id?: string) => void;
  tab: (activity: boolean) => void;
}) {
  const catalog = useAgentCatalog(sessionId);
  const child = catalog.data?.subagents.find((a) => a.id === agentId);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [search, setSearch] = useState('');
  const choose = (id?: string) => {
    dialog.current?.close();
    select(id);
  };
  useEffect(() => () => dialog.current?.close(), []);
  return (
    <div className="conversation-navigation">
      <button
        ref={trigger}
        className="conversation-picker"
        aria-haspopup="dialog"
        aria-label={`Choose conversation: ${child?.name ?? (agentId ? 'Sub-agent' : 'Main conversation')}`}
        onClick={() => {
          setSearch('');
          dialog.current?.showModal();
        }}
      >
        {agentId ? (
          <GitBranch size={17} aria-hidden="true" />
        ) : (
          <MessageSquare size={17} aria-hidden="true" />
        )}
        <span>{child?.name ?? (agentId ? 'Sub-agent conversation' : 'Main conversation')}</span>
        <span className="agent-count">{catalog.data?.subagents.length || 0} agents</span>
        <ChevronDown size={16} aria-hidden="true" />
      </button>
      <nav className="conversation-tabs" aria-label="Conversation view">
        <button aria-current={!activity ? 'page' : undefined} onClick={() => tab(false)}>
          Chat
        </button>
        <button aria-current={activity ? 'page' : undefined} onClick={() => tab(true)}>
          Activity
        </button>
      </nav>
      <dialog
        ref={dialog}
        className="conversation-picker-dialog"
        aria-labelledby="conversation-picker-title"
        onClose={() => trigger.current?.focus({ preventScroll: true })}
        onClick={(e) => {
          if (e.target === dialog.current) dialog.current?.close();
        }}
      >
        <div className="picker-heading">
          <h2 id="conversation-picker-title">Conversations</h2>
          <button aria-label="Close conversation picker" onClick={() => dialog.current?.close()}>
            <X size={20} />
          </button>
        </div>
        <label className="picker-search">
          Find an agent
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Name or model"
          />
        </label>
        <div className="picker-conversations">
          <button
            className="picker-conversation parent-conversation"
            onClick={() => choose()}
            aria-current={!agentId ? 'page' : undefined}
          >
            <MessageSquare size={18} aria-hidden="true" />
            <span>
              <strong>{title}</strong>
              <small>Main conversation</small>
            </span>
            {!agentId && <Check size={18} aria-hidden="true" />}
          </button>
          <p className="picker-section">
            Sub-agents <span>{catalog.data?.subagents.length ?? 0}</span>
          </p>
          {catalog.isPending && <p role="status">Finding linked agents…</p>}
          {catalog.error && (
            <div role="alert">
              <p>{catalog.error.message}</p>
              <button onClick={() => void catalog.refetch()}>Retry</button>
            </div>
          )}
          {catalog.data && !catalog.data.supported && (
            <p>This harness does not expose linked agents yet.</p>
          )}
          {catalog.data?.supported && !catalog.data.subagents.length && (
            <p>No linked sub-agents recorded yet.</p>
          )}
          {catalog.data?.subagents
            .filter((a) =>
              `${a.name} ${a.model ?? ''}`.toLowerCase().includes(search.toLowerCase()),
            )
            .map((a) => (
              <button
                key={a.id}
                className="picker-conversation"
                onClick={() => choose(a.id)}
                aria-current={agentId === a.id ? 'page' : undefined}
              >
                <GitBranch size={18} aria-hidden="true" />
                <span>
                  <strong>{a.name}</strong>
                  <small>{a.model || 'Model not reported'}</small>
                  <small>
                    <span className={`agent-dot ${a.status}`} aria-hidden="true" />
                    {agentStatus(a.status)} · {new Date(a.updatedAt).toLocaleString()}
                  </small>
                </span>
                {agentId === a.id ? (
                  <Check size={18} aria-hidden="true" />
                ) : (
                  <ChevronDown size={16} className="picker-row-chevron" aria-hidden="true" />
                )}
              </button>
            ))}
          {search &&
          catalog.data?.subagents.length &&
          !catalog.data.subagents.some((a) =>
            `${a.name} ${a.model ?? ''}`.toLowerCase().includes(search.toLowerCase()),
          ) ? (
            <p>No agents match this search.</p>
          ) : null}
        </div>
        <p className="picker-footnote">
          Sub-agent conversations are view only. Send instructions through the main conversation.
        </p>
      </dialog>
    </div>
  );
}
