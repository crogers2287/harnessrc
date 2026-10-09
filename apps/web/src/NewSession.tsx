import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ChevronRight, Folder, FolderOpen, LoaderCircle } from 'lucide-react';
import { ApiError, api } from '@harnessrc/client-sdk';
import type { SessionView } from '@harnessrc/protocol';

type Profile = {
  id: string;
  hostId: string;
  label: string;
  harness: string;
  provider: string;
  connected: boolean;
  models: { id: string; name: string }[];
  allowCustomModel: boolean;
  defaultModel?: string;
};
type Folders = {
  path: string;
  parent: string | null;
  directories: { name: string; path: string }[];
  truncated: boolean;
};
type Receipt = {
  requestId: string;
  hostId: string;
  status: 'starting' | 'started' | 'uncertain';
  terminalId?: string;
  diagnostic?: string;
};
type Draft = {
  requestId: string;
  profileId: string;
  cwd: string;
  name: string;
  model: string;
  prompt: string;
};
const labels: Record<string, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  pi: 'Pi',
  omp: 'OMP',
  opencode: 'OpenCode',
  hermes: 'Hermes',
  dsh: 'DSH',
};
function saved(): Draft {
  try {
    const data = JSON.parse(sessionStorage.getItem('relay-launch-draft') ?? 'null');
    if (data?.requestId) return { ...data, prompt: data.prompt ?? '' };
  } catch {
    /* storage may be unavailable */
  }
  return {
    requestId: crypto.randomUUID(),
    profileId: '',
    cwd: '',
    name: '',
    model: '',
    prompt: '',
  };
}
export function NewSession({
  back,
  opened,
  sessions,
}: {
  back: () => void;
  opened: (id: string) => void;
  sessions: SessionView[];
}) {
  const query = useQueryClient();
  const [draft, setDraft] = useState(saved);
  const [browse, setBrowse] = useState(false);
  const [folderPath, setFolderPath] = useState<string>();
  const [typedPath, setTypedPath] = useState('');
  const [custom, setCustom] = useState(!!draft.model);
  const profiles = useQuery<{ profiles: Profile[] }>({
    queryKey: ['launch-profiles'],
    queryFn: () => api('/api/launch/profiles'),
    refetchOnMount: 'always',
    refetchInterval: 30000,
  });
  const list = profiles.data?.profiles ?? [];
  const profile = list.find((p) => p.id === draft.profileId) ?? list[0];
  const folders = useQuery<Folders>({
    queryKey: ['folders', profile?.id, folderPath],
    queryFn: () =>
      api(
        `/api/launch/folders?${new URLSearchParams({ profileId: profile!.id, ...(folderPath ? { path: folderPath } : {}) })}`,
      ),
    enabled: browse && !!profile,
  });
  const [receipt, setReceipt] = useState<Receipt>();
  const [attempted, setAttempted] = useState(
    () => sessionStorage.getItem('relay-launch-pending') === draft.requestId,
  );
  const recovery = useQuery<Receipt>({
    queryKey: ['launch', draft.requestId],
    queryFn: () => api(`/api/launch/${draft.requestId}`),
    enabled: attempted && (!receipt || receipt.status === 'starting'),
    retry: false,
    refetchInterval: 2000,
  });
  useEffect(() => {
    if (recovery.data) setReceipt(recovery.data);
  }, [recovery.data]);
  useEffect(() => {
    try {
      sessionStorage.setItem('relay-launch-draft', JSON.stringify(draft));
    } catch {
      /* optional */
    }
  }, [draft]);
  useEffect(() => {
    if (!receipt?.terminalId) return;
    const found = sessions.find(
      (s) =>
        s.hostId === receipt.hostId &&
        s.terminalId === receipt.terminalId &&
        s.status !== 'ended' &&
        !s.nativeSessionId.startsWith('unbound:'),
    );
    if (found) {
      sessionStorage.removeItem('relay-launch-draft');
      sessionStorage.removeItem('relay-launch-pending');
      opened(found.id);
    }
  }, [sessions, receipt, opened]);
  const launch = useMutation({
    mutationFn: async () => {
      const request = {
        ...draft,
        profileId: profile!.id,
        name: draft.name.trim() || draft.cwd.split('/').filter(Boolean).at(-1) || 'New session',
      };
      setDraft(request);
      setAttempted(true);
      sessionStorage.setItem('relay-launch-pending', draft.requestId);
      return api<Receipt>('/api/launch', { method: 'POST', body: JSON.stringify(request) });
    },
    onError: (error) => {
      if (error instanceof ApiError) {
        setAttempted(false);
        sessionStorage.removeItem('relay-launch-pending');
      }
    },
    onSuccess: (value) => {
      setReceipt(value);
      void query.invalidateQueries({ queryKey: ['sessions'] });
    },
  });
  const frozen = launch.isPending || !!receipt || attempted;
  const chooseProfile = (value: Profile) => {
    setDraft((d) => ({
      ...d,
      profileId: value.id,
      model: '',
      cwd: value.hostId === profile?.hostId ? d.cwd : '',
    }));
    setCustom(false);
    setFolderPath(undefined);
  };
  return (
    <section className="new-session-page">
      <header className="page-header">
        <button className="icon-button" aria-label="Back to conversation" onClick={back}>
          <ArrowLeft size={22} />
        </button>
        <h2>New session</h2>
      </header>
      <div className="new-session-scroll">
        <form
          className="new-session-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!frozen) launch.mutate();
          }}
        >
          <p className="form-intro">Choose where to work and who to work with.</p>
          {profiles.isPending && <p role="status">Loading agents…</p>}
          {profiles.error && <p role="alert">{profiles.error.message}</p>}
          {profiles.isSuccess && !list.length && (
            <p role="status">Session creation has not been configured on this host yet.</p>
          )}
          {profile && (
            <>
              <fieldset disabled={frozen}>
                <label>
                  Agent
                  <select
                    value={profile.harness}
                    onChange={(e) =>
                      chooseProfile(
                        list.find(
                          (p) => p.hostId === profile.hostId && p.harness === e.target.value,
                        ) ?? list.find((p) => p.harness === e.target.value)!,
                      )
                    }
                  >
                    {[...new Set(list.map((p) => p.harness))].map((h) => (
                      <option key={h} value={h}>
                        {labels[h] ?? h}
                      </option>
                    ))}
                  </select>
                </label>
                {[
                  ...new Set(
                    list.filter((p) => p.harness === profile.harness).map((p) => p.hostId),
                  ),
                ].length > 1 && (
                  <label>
                    Host
                    <select
                      value={profile.hostId}
                      onChange={(e) =>
                        chooseProfile(
                          list.find(
                            (p) => p.hostId === e.target.value && p.harness === profile.harness,
                          )!,
                        )
                      }
                    >
                      {[
                        ...new Set(
                          list.filter((p) => p.harness === profile.harness).map((p) => p.hostId),
                        ),
                      ].map((host) => (
                        <option key={host}>{host}</option>
                      ))}
                    </select>
                  </label>
                )}
                <div className="field-label">Working folder on {profile.hostId}</div>
                <button
                  className="folder-choice"
                  type="button"
                  onClick={() => {
                    setFolderPath(draft.cwd || undefined);
                    setBrowse(!browse);
                  }}
                  aria-expanded={browse}
                >
                  <FolderOpen size={22} aria-hidden="true" />
                  <span>{draft.cwd || 'Choose a folder on ' + profile.hostId}</span>
                  <ChevronRight size={18} aria-hidden="true" />
                </button>
                {browse && (
                  <div className="folder-browser">
                    <label className="path-entry">
                      Folder path
                      <input
                        value={typedPath}
                        onChange={(e) => setTypedPath(e.target.value)}
                        placeholder="/home/…"
                        autoCapitalize="none"
                        spellCheck={false}
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => setFolderPath(typedPath)}
                      disabled={!typedPath}
                    >
                      Go to folder
                    </button>
                    {folders.isFetching && <p role="status">Opening folder…</p>}
                    {folders.error && <p role="alert">{folders.error.message}</p>}
                    {folders.data && !folders.isFetching && !folders.error && (
                      <>
                        <code className="folder-current">{folders.data.path}</code>
                        {folders.data.parent && (
                          <button
                            type="button"
                            onClick={() => setFolderPath(folders.data!.parent!)}
                          >
                            <ArrowLeft size={18} aria-hidden="true" />
                            Parent folder
                          </button>
                        )}
                        <div className="folder-entries">
                          {folders.data.directories.map((dir) => (
                            <button
                              type="button"
                              key={dir.path}
                              onClick={() => setFolderPath(dir.path)}
                            >
                              <Folder size={18} aria-hidden="true" />
                              <span>{dir.name}</span>
                              <ChevronRight size={16} aria-hidden="true" />
                            </button>
                          ))}
                        </div>
                        {folders.data.truncated && (
                          <p>Showing the first 500 folders. Enter a path to open another.</p>
                        )}
                        <button
                          type="button"
                          className="primary"
                          onClick={() => {
                            setDraft((d) => ({ ...d, cwd: folders.data!.path }));
                            setBrowse(false);
                          }}
                        >
                          Use this folder
                        </button>
                      </>
                    )}
                  </div>
                )}
                <label>
                  Provider
                  <select
                    value={profile.id}
                    onChange={(e) => chooseProfile(list.find((p) => p.id === e.target.value)!)}
                  >
                    {list
                      .filter((p) => p.hostId === profile.hostId && p.harness === profile.harness)
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.provider}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  Model
                  <select
                    aria-label="Model"
                    value={custom ? '__custom' : draft.model}
                    onChange={(e) => {
                      setCustom(e.target.value === '__custom');
                      setDraft((d) => ({
                        ...d,
                        model: e.target.value === '__custom' ? '' : e.target.value,
                      }));
                    }}
                  >
                    <option value="">
                      {profile.defaultModel ? `Default: ${profile.defaultModel}` : 'Agent default'}
                    </option>
                    {profile.models.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                    {profile.allowCustomModel && <option value="__custom">Custom model…</option>}
                  </select>
                </label>
                {custom && (
                  <label>
                    Custom model ID
                    <input
                      value={draft.model}
                      onChange={(e) => setDraft((d) => ({ ...d, model: e.target.value }))}
                      autoCapitalize="none"
                      spellCheck={false}
                      pattern="[a-zA-Z0-9][a-zA-Z0-9._:/@+\-]*"
                      required
                    />
                    <small>Use a model ID available through {profile.provider}.</small>
                  </label>
                )}
                <label>
                  First message
                  <textarea
                    rows={3}
                    required
                    maxLength={32000}
                    value={draft.prompt}
                    placeholder="What would you like to work on?"
                    onChange={(e) => setDraft((d) => ({ ...d, prompt: e.target.value }))}
                  />
                </label>
                <label>
                  <span>
                    Session name <span className="optional">(optional)</span>
                  </span>
                  <input
                    value={draft.name}
                    maxLength={80}
                    placeholder={draft.cwd.split('/').at(-1) || 'Project name'}
                    onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                  />
                </label>
              </fieldset>
              {launch.error && <p role="alert">{launch.error.message}</p>}
              {receipt && (
                <p role="status">
                  {receipt.status === 'uncertain'
                    ? receipt.diagnostic
                    : receipt.status === 'starting'
                      ? 'Starting your agent…'
                      : 'Agent started. Connecting its conversation…'}
                </p>
              )}
              {attempted && !receipt && !launch.isPending && (
                <p role="status">Checking the saved launch request…</p>
              )}
              {!profile.connected && <p role="status">{profile.hostId} is disconnected.</p>}
              {receipt && (
                <div className="launch-recovery">
                  <button type="button" onClick={back}>
                    Back to conversation
                  </button>
                  {receipt.status !== 'starting' && (
                    <button
                      type="button"
                      onClick={() => {
                        sessionStorage.removeItem('relay-launch-pending');
                        setReceipt(undefined);
                        setAttempted(false);
                        setDraft((d) => ({ ...d, requestId: crypto.randomUUID() }));
                        launch.reset();
                      }}
                    >
                      Start another session
                    </button>
                  )}
                </div>
              )}
              {attempted && !receipt && launch.error && (
                <button type="button" onClick={() => launch.mutate()}>
                  Retry saved request
                </button>
              )}
              <div className="launch-action">
                <button
                  className="primary"
                  disabled={
                    frozen ||
                    !profile.connected ||
                    !draft.cwd ||
                    !draft.prompt.trim() ||
                    (custom && !draft.model)
                  }
                  type="submit"
                >
                  {frozen ? (
                    <>
                      <LoaderCircle
                        className={receipt?.status === 'uncertain' ? '' : 'launch-spinner'}
                        size={18}
                        aria-hidden="true"
                      />
                      {receipt?.status === 'uncertain' ? 'Check session list' : 'Starting session…'}
                    </>
                  ) : (
                    'Start session'
                  )}
                </button>
                <small>
                  Your session stays running on {profile.hostId} when you close the app.
                </small>
              </div>
            </>
          )}
        </form>
      </div>
    </section>
  );
}
