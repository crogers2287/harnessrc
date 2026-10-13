import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@harnessrc/client-sdk';
import type { SessionView, ModelCatalog } from '@harnessrc/protocol';
export function SessionModel({ session }: { session: SessionView }) {
  const query = useQueryClient();
  const catalog = useQuery<ModelCatalog>({
    queryKey: ['session-models', session.id],
    queryFn: () => api(`/api/sessions/${session.id}/models`),
  });
  const [choice, setChoice] = useState('');
  const mutation = useMutation({
    mutationFn: () => api(`/api/sessions/${session.id}/model`, { method: 'POST', body: choice }),
    onSuccess: () => {
      setChoice('');
      void query.invalidateQueries({ queryKey: ['sessions'] });
      void query.invalidateQueries({ queryKey: ['session-models', session.id] });
    },
  });
  const current = catalog.data?.current ?? catalog.data?.default;
  return (
    <section className="settings-section">
      <h3>Session model</h3>
      <p className="helper">
        {catalog.data?.reason ??
          'Choose the provider and model for the next model request. An in-flight request keeps its current model.'}
      </p>
      {catalog.isPending ? (
        <p role="status">Loading models…</p>
      ) : catalog.error ? (
        <p className="error" role="alert">
          {catalog.error.message}
        </p>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate();
          }}
        >
          <label>
            Model
            <select
              value={
                choice ||
                (current
                  ? JSON.stringify({ provider: current.provider, model: current.model })
                  : '')
              }
              onChange={(e) => setChoice(e.target.value)}
              disabled={mutation.isPending}
            >
              {catalog.data?.groups.map((g) => (
                <optgroup key={g.id} label={g.name}>
                  {g.models.map((m) => (
                    <option key={m.id} value={JSON.stringify({ provider: g.id, model: m.id })}>
                      {m.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <button className="primary" disabled={!choice || mutation.isPending}>
            {mutation.isPending ? 'Applying…' : 'Apply model'}
          </button>
        </form>
      )}
      {mutation.isSuccess && <p role="status">Model selection saved.</p>}
      {mutation.error && (
        <p className="error" role="alert">
          {mutation.error.message}
        </p>
      )}
    </section>
  );
}
