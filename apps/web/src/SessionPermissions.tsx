import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '@harnessrc/client-sdk';
import type { PermissionSettings } from '@harnessrc/protocol';
const labels: Record<string, string> = {
  'read-only': 'Read only',
  'workspace-write': 'Workspace write',
  'danger-full-access': 'Full access',
};
export function SessionPermissions({ sessionId }: { sessionId: string }) {
  const settings = useQuery<PermissionSettings>({
    queryKey: ['permissions', sessionId],
    queryFn: () => api(`/api/sessions/${sessionId}/permissions`),
  });
  const [choice, setChoice] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const change = useMutation({
    mutationFn: () =>
      api<PermissionSettings>(`/api/sessions/${sessionId}/permissions`, {
        method: 'POST',
        body: JSON.stringify({
          value: choice,
          expected: settings.data?.current,
          confirm: confirmed,
        }),
      }),
    onSuccess: async () => {
      setChoice('');
      setConfirmed(false);
      await settings.refetch();
    },
  });
  return (
    <section className="settings-section" aria-label="Session permissions">
      <h3>Session permissions</h3>
      <p className="helper">Controls what this agent may do on its host.</p>
      {settings.isPending ? (
        <p role="status">Loading permissions…</p>
      ) : settings.error ? (
        <p role="alert" className="error">
          {settings.error.message} <button onClick={() => void settings.refetch()}>Retry</button>
        </p>
      ) : !settings.data?.supported ? (
        <p className="helper">{settings.data?.reason}</p>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (confirmed) change.mutate();
          }}
        >
          <label>
            Permission preset
            <select
              aria-label="Permission preset"
              value={choice || settings.data.current}
              disabled={change.isPending}
              onChange={(e) => {
                setChoice(e.target.value);
                setConfirmed(false);
                change.reset();
              }}
            >
              {!settings.data.options.some((o) => o.value === settings.data?.current) && (
                <option value={settings.data.current}>{settings.data.current}</option>
              )}
              {settings.data.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {labels[o.value] ?? o.name}
                </option>
              ))}
            </select>
          </label>
          <p className="helper">
            {
              settings.data.options.find((o) => o.value === (choice || settings.data?.current))
                ?.description
            }
          </p>
          {choice && choice !== settings.data.current && (
            <>
              <p>
                {choice === 'danger-full-access'
                  ? 'Full access lets this agent run commands outside the workspace without its normal sandbox restrictions. Only enable this for a session you trust.'
                  : `Apply ${labels[choice] ?? choice} to this session. This does not restart the agent or send a chat message.`}
              </p>
              <label className="choice">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                  disabled={change.isPending}
                />{' '}
                Apply this permission change to this session
              </label>
              <button className="primary" disabled={!confirmed || change.isPending}>
                {change.isPending ? 'Applying…' : 'Apply permissions'}
              </button>
            </>
          )}
        </form>
      )}
      {change.isSuccess && <p role="status">Permissions saved in the harness.</p>}
      {change.error && (
        <p role="alert" className="error">
          {change.error.message}
        </p>
      )}
    </section>
  );
}
