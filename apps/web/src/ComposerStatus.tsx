import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ModelCatalog, PermissionSettings, SessionView } from '@harnessrc/protocol';
import { api } from '@harnessrc/client-sdk';
import { X } from 'lucide-react';
import { SessionPermissions } from './SessionPermissions.tsx';
import { ProviderSwap } from './ProviderSwap.tsx';

type Usage = {
  supported: boolean;
  input?: number;
  output?: number;
  total?: number;
  contextUsed?: number;
  contextWindow?: number;
  updatedAt?: string;
  reason?: string;
  partial?: boolean;
};
const number = (n?: number) =>
  n === undefined
    ? 'Not reported'
    : Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(n);
export function ComposerStatus({ session }: { session: SessionView }) {
  const query = useQueryClient();
  const [panel, setPanel] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const models = useQuery<ModelCatalog>({
    queryKey: ['session-models', session.id],
    queryFn: () => api(`/api/sessions/${session.id}/models`),
    enabled: session.connected && session.capabilities.changeModel,
    refetchInterval: 60000,
    retry: false,
  });
  const permissions = useQuery<PermissionSettings>({
    queryKey: ['permissions', session.id],
    queryFn: () => api(`/api/sessions/${session.id}/permissions`),
    enabled: session.connected,
    refetchInterval: 60000,
    retry: false,
  });
  const mode = useQuery<PermissionSettings>({
    queryKey: ['mode', session.id],
    queryFn: () => api(`/api/sessions/${session.id}/mode`),
    enabled: session.connected,
    refetchInterval: 60000,
    retry: false,
  });
  const usage = useQuery<Usage>({
    queryKey: ['usage', session.id],
    queryFn: () => api(`/api/sessions/${session.id}/usage`),
    enabled: session.connected,
    refetchInterval: 10000,
    retry: false,
  });
  useEffect(() => {
    if (!panel) {
      dialog.current?.close();
      return;
    }
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    return () => previous?.focus({ preventScroll: true });
  }, [panel]);
  const current = models.data?.current ?? models.data?.default;
  const selected = models.data?.groups
    .find((g) => g.id === current?.provider)
    ?.models.find((m) => m.id === current?.model);
  return (
    <>
      <div className="composer-status" aria-label="Native session settings">
        <button onClick={() => setPanel('usage')} aria-label="Token usage">
          {usage.data?.supported
            ? `${number(usage.data.contextUsed ?? usage.data.total)}${usage.data.contextWindow ? ` / ${number(usage.data.contextWindow)}` : ''} tokens`
            : 'Tokens: not reported'}
        </button>
        <button
          onClick={() => setPanel('model')}
          aria-label="Quick model settings"
          title={current?.model || session.model}
        >
          Model: {current?.model || session.model || 'Not reported'}
        </button>
        <button onClick={() => setPanel('thinking')} aria-label="Quick thinking settings">
          Think:{' '}
          {current?.reasoningEffort ||
            (selected?.reasoningEfforts?.length ? 'Default' : 'Not exposed')}
        </button>
        <button onClick={() => setPanel('permissions')} aria-label="Quick permission settings">
          {permissions.data?.currentName || permissions.data?.current || 'Permissions: not exposed'}
        </button>
        {mode.data?.supported && (
          <button onClick={() => setPanel('mode')} aria-label="Quick agent mode">
            Mode: {mode.data.currentName || mode.data.current}
          </button>
        )}
      </div>
      <dialog
        ref={dialog}
        className="native-settings-dialog"
        aria-label="Native session settings"
        onCancel={(e) => {
          e.preventDefault();
          setPanel('');
        }}
      >
        {panel && (
          <>
            <header className="helper-heading">
              <h2>
                {panel === 'usage'
                  ? 'Token usage'
                  : panel === 'thinking'
                    ? 'Thinking level'
                    : panel === 'model'
                      ? 'Model'
                      : panel === 'mode'
                        ? 'Agent mode'
                        : 'Permissions'}
              </h2>
              <button
                aria-label="Close session settings"
                onClick={() => {
                  setPanel('');
                  void query.invalidateQueries({ queryKey: [panel, session.id] });
                }}
              >
                <X size={22} />
              </button>
            </header>
            <div className="native-settings-body">
              {panel === 'usage' ? (
                usage.data?.supported ? (
                  <>
                    <dl>
                      <dt>Current context</dt>
                      <dd>
                        {number(usage.data.contextUsed)} tokens
                        {usage.data.contextWindow ? ` of ${number(usage.data.contextWindow)}` : ''}
                      </dd>
                      <dt>Session input</dt>
                      <dd>{number(usage.data.input)} tokens</dd>
                      <dt>Session output</dt>
                      <dd>{number(usage.data.output)} tokens</dd>
                      <dt>Session total</dt>
                      <dd>
                        {number(usage.data.total)} tokens
                        {usage.data.partial ? ' (retained history)' : ''}
                      </dd>
                    </dl>
                    <p>
                      Native reported counters. Context use and accumulated session use are
                      different measurements.
                    </p>
                  </>
                ) : (
                  <p>
                    {usage.data?.reason ||
                      usage.error?.message ||
                      'Waiting for native usage counters.'}
                  </p>
                )
              ) : panel === 'permissions' || panel === 'mode' ? (
                <SessionPermissions sessionId={session.id} kind={panel} />
              ) : models.data ? (
                <ModelControls session={session} catalog={models.data} />
              ) : models.isFetching ? (
                <p role="status">Loading native settings…</p>
              ) : (
                <>
                  <p>
                    {models.error?.message ||
                      'This harness does not expose live model or thinking changes.'}
                  </p>
                  {panel === 'model' && (
                    <ProviderSwap session={session} close={() => setPanel('')} />
                  )}
                </>
              )}
            </div>
          </>
        )}
      </dialog>
    </>
  );
}

export function ModelControls({
  session,
  catalog,
}: {
  session: SessionView;
  catalog: ModelCatalog;
}) {
  const query = useQueryClient();
  const current = catalog.current ?? catalog.default;
  const [value, setValue] = useState(
    JSON.stringify({ provider: current.provider, model: current.model }),
  );
  const [effort, setEffort] = useState(current.reasoningEffort ?? '');
  const choice = JSON.parse(value) as { provider: string; model: string };
  const model = catalog.groups
    .find((g) => g.id === choice.provider)
    ?.models.find((m) => m.id === choice.model);
  const change = useMutation({
    mutationFn: () =>
      api(`/api/sessions/${session.id}/model`, {
        method: 'POST',
        headers: { 'X-RC-Generation': session.generation },
        body: JSON.stringify({ ...choice, ...(effort ? { reasoningEffort: effort } : {}) }),
      }),
    onSuccess: async () => {
      await query.invalidateQueries({ queryKey: ['session-models', session.id] });
      await query.invalidateQueries({ queryKey: ['sessions'] });
    },
  });
  return (
    <form
      className="quick-model-form"
      onSubmit={(e) => {
        e.preventDefault();
        change.mutate();
      }}
    >
      <p>
        {catalog.reason ||
          'Applies to the next model request. A running request keeps its current settings.'}
      </p>
      <label>
        Model
        <select
          aria-label="Native model"
          value={value}
          disabled={change.isPending}
          onChange={(e) => {
            setValue(e.target.value);
            const chosen = JSON.parse(e.target.value);
            const next = catalog.groups
              .find((g) => g.id === chosen.provider)
              ?.models.find((m) => m.id === chosen.model);
            setEffort(next?.defaultReasoningEffort ?? '');
            change.reset();
          }}
        >
          {!catalog.groups.some(
            (g) => g.id === current.provider && g.models.some((m) => m.id === current.model),
          ) && (
            <option value={JSON.stringify({ provider: current.provider, model: current.model })}>
              {current.model}
            </option>
          )}
          {catalog.groups.map((g) => (
            <optgroup label={g.name} key={g.id}>
              {g.models.map((m) => (
                <option key={m.id} value={JSON.stringify({ provider: g.id, model: m.id })}>
                  {m.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      {model?.reasoningEfforts?.length ? (
        <label>
          Thinking level
          <select
            aria-label="Thinking level"
            value={effort}
            onChange={(e) => {
              setEffort(e.target.value);
              change.reset();
            }}
            disabled={change.isPending}
          >
            <option value="">Harness default</option>
            {model.reasoningEfforts.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <p>This model does not expose selectable thinking levels.</p>
      )}
      <button
        className="primary"
        disabled={change.isPending || !session.connected || !session.capabilities.changeModel}
      >
        {change.isPending ? 'Applying…' : 'Apply model settings'}
      </button>
      {change.isSuccess && <p role="status">Native model settings saved.</p>}
      {change.error && <p role="alert">{change.error.message}</p>}
    </form>
  );
}
