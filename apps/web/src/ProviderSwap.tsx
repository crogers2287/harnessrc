import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, api } from '@harnessrc/client-sdk';
import type { SessionView } from '@harnessrc/protocol';

type Profile = {
  id: string;
  label: string;
  provider: string;
  connected: boolean;
  models: { id: string; name: string }[];
  allowCustomModel: boolean;
  defaultModel?: string;
  permissions: { id: string; name: string }[];
};
type Receipt = { status: 'restarting' | 'started' | 'uncertain'; diagnostic?: string };
type Request = {
  requestId: string;
  generation: string;
  profileId: string;
  model: string;
  permission?: string;
  confirm: true;
};
export function ProviderSwap({ session: s, close }: { session: SessionView; close: () => void }) {
  const storageKey = `relay-provider-swap-${s.id}`;
  const [attempt, setAttempt] = useState<Request | undefined>(() => {
    try {
      return JSON.parse(sessionStorage.getItem(storageKey) ?? 'null') ?? undefined;
    } catch {
      return undefined;
    }
  });
  const [profileId, setProfileId] = useState('');
  const [model, setModel] = useState('');
  const [permission, setPermission] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [rejected, setRejected] = useState(false);
  const [receipt, setReceipt] = useState<Receipt>();
  const query = useQueryClient();
  const catalog = useQuery<{
    supported: boolean;
    reason?: string;
    generation: string;
    profiles: Profile[];
  }>({
    queryKey: ['provider-swap', s.id],
    queryFn: () => api(`/api/sessions/${s.id}/provider-swap`),
    retry: false,
  });
  const profiles = catalog.data?.profiles ?? [];
  const profile = profiles.find((p) => p.id === profileId) ?? profiles[0];
  const recovery = useQuery<Receipt>({
    queryKey: ['provider-swap-receipt', s.id, attempt?.requestId],
    queryFn: () => api(`/api/sessions/${s.id}/provider-swap/${attempt!.requestId}`),
    enabled: !!attempt,
    retry: false,
    refetchInterval: receipt?.status === 'restarting' || (!receipt && attempt) ? 2000 : false,
  });
  useEffect(() => {
    if (recovery.data) {
      setReceipt(recovery.data);
      if (recovery.data.status === 'started')
        void query.invalidateQueries({ queryKey: ['sessions'] });
    }
  }, [recovery.data, query]);
  async function submit(body: Request) {
    setAttempt(body);
    setSending(true);
    setError('');
    setRejected(false);
    sessionStorage.setItem(storageKey, JSON.stringify(body));
    try {
      setReceipt(
        await api(`/api/sessions/${s.id}/provider-swap`, {
          method: 'POST',
          body: JSON.stringify(body),
        }),
      );
      void recovery.refetch();
    } catch (e) {
      setError((e as Error).message);
      setRejected(e instanceof ApiError && [400, 409, 422].includes(e.status));
      void recovery.refetch();
    } finally {
      setSending(false);
    }
  }
  if (attempt)
    return (
      <div className="provider-swap-form">
        <p role="status">
          {receipt?.diagnostic ??
            'Checking restart. Your original request is retained; no second session will be started automatically.'}
        </p>
        {(sending || receipt?.status === 'restarting') && (
          <p aria-live="polite">Restarting and resuming conversation…</p>
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <button onClick={() => void recovery.refetch()} disabled={sending}>
          Check restart
        </button>
        {rejected && recovery.error instanceof ApiError && recovery.error.status === 404 && (
          <button
            onClick={() => {
              sessionStorage.removeItem(storageKey);
              setAttempt(undefined);
              setConfirm(false);
            }}
          >
            Edit choices
          </button>
        )}
        {!receipt && (
          <button disabled={sending} onClick={() => void submit(attempt)}>
            Retry same request
          </button>
        )}
        {receipt?.status === 'started' && (
          <button
            className="primary"
            onClick={() => {
              sessionStorage.removeItem(storageKey);
              close();
            }}
          >
            Return to conversation
          </button>
        )}
      </div>
    );
  return (
    <form
      className="provider-swap-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (profile && confirm)
          void submit({
            requestId: crypto.randomUUID(),
            generation: catalog.data!.generation,
            profileId: profile.id,
            model: model || profile.defaultModel || profile.models[0]?.id || '',
            ...(permission ? { permission } : {}),
            confirm: true,
          });
      }}
    >
      {catalog.isPending ? (
        <p role="status">Loading providers…</p>
      ) : catalog.error ? (
        <p role="alert">{catalog.error.message}</p>
      ) : !catalog.data?.supported ? (
        <p>{catalog.data?.reason}</p>
      ) : (
        <>
          <p>
            Resume this conversation in <code>{s.cwd}</code> with a different provider and model.
          </p>
          <label>
            Provider
            <select
              value={profile?.id ?? ''}
              onChange={(e) => {
                setProfileId(e.target.value);
                setModel('');
                setPermission('');
                setConfirm(false);
              }}
            >
              {profiles.map((p) => (
                <option key={p.id} value={p.id} disabled={!p.connected}>
                  {p.provider} · {p.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Model
            {profile?.allowCustomModel ? (
              <input
                list={`swap-models-${s.id}`}
                value={model || profile.defaultModel || ''}
                placeholder="Model ID"
                onChange={(e) => setModel(e.target.value)}
                required
              />
            ) : (
              <select
                value={model || profile?.defaultModel || profile?.models[0]?.id || ''}
                onChange={(e) => setModel(e.target.value)}
                required
              >
                {profile?.models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            )}
          </label>
          <datalist id={`swap-models-${s.id}`}>
            {profile?.models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </datalist>
          {!!profile?.permissions.length && (
            <label>
              Permissions after restart
              <select
                value={permission}
                onChange={(e) => {
                  setPermission(e.target.value);
                  setConfirm(false);
                }}
                required
              >
                <option value="">Choose permissions</option>
                {profile.permissions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <p className="muted">
            The current process closes after it is idle. Conversation history stays; queued work
            pauses for review.
          </p>
          <label className="provider-swap-confirm">
            <input
              type="checkbox"
              checked={confirm}
              onChange={(e) => setConfirm(e.target.checked)}
            />
            Restart this harness with the selected provider, model and permissions.
          </label>
          {s.status === 'working' || s.status === 'blocked' ? (
            <p role="status">Finish or stop the current turn and resolve questions first.</p>
          ) : null}
          <button
            className="primary"
            disabled={
              !confirm ||
              !profile?.connected ||
              !['idle', 'done'].includes(s.status) ||
              !(model || profile?.defaultModel || profile?.models[0]?.id) ||
              (!!profile?.permissions.length && !permission)
            }
          >
            Restart and resume
          </button>
        </>
      )}
    </form>
  );
}
