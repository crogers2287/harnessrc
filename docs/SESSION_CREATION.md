# Create sessions from a phone

Open the session drawer → **New session**. Choose a directory on Fred, agent, provider, model, first message, and optional name. Relay starts a new Herdr tab without moving the terminal user's focus. Closing the phone does not stop it.

Only administrator devices can browse host folders or create sessions. Authenticated tailnet devices have the configured administrative access; paired devices with session-only grants cannot launch arbitrary processes. Directory browsing is local to the gateway host and restricted to configured roots, including realpath/symlink checks. Remote gateway filesystem browsing is not implemented.

## Configure launch profiles

Add `launchProfiles` to the gateway JSON configuration. IDs are unique. `workspaceId` must be a real Herdr workspace. This example uses existing **host configuration**, not client-provided shell commands:

```json
{
  "id": "codex-cfrproxy",
  "hostId": "fred",
  "label": "Codex via CFRproxy",
  "harness": "codex",
  "provider": "CFRproxy",
  "workspaceId": "w10",
  "roots": ["/home/YOUR_USER/projects"],
  "codexProvider": "local_models",
  "args": ["-c", "model_provider=\"local_models\""],
  "modelsEndpoint": "http://127.0.0.1:8420/v1/models",
  "models": [],
  "allowCustomModel": true
}
```

`defaultModel` optionally names the provider model to use when the form selects Default. Set it for proxy profiles so an unrelated account default is never passed to a different provider.

`local_models` must already be a correctly configured native Codex provider. The optional endpoint reads an OpenAI-style `data[].id` catalogue with a three-second timeout and 60-second cache. It only advertises upstream identifiers; a listed model may still fail upstream or be unsuitable for coding. Configure a curated static `models: [{"id":"…","name":"…"}]` list by omitting the endpoint. `allowCustomModel` enables literal model IDs, not arbitrary CLI flags or provider URLs.

Claude profiles can supply native `--settings` arguments for provider routing. Credentials belong on the host. The optional `environment` map maps a child environment variable name to an existing gateway environment variable **name**, never a browser-supplied value. Neither launch commands nor environment values are returned to clients or added to launch audit records. Interactive shell aliases can override environment variables; verify the actual native provider route. Do not add an unverified profile simply to make a harness appear supported.

## Ownership and reliability

The installed Herdr 0.8.0/protocol 19 schema defines `tab.create`, `agent.start`, `agent.get`, and `agent.prompt`. New tabs can initially reject `agent.start` with `agent_pane_busy`; that explicit pre-dispatch rejection alone is retried after checking the terminal ID. Successful socket `agent.start` acknowledgement precedes readiness, so Relay waits for the correct named agent to become interactive before submitting the first message. Multiline messages use `agent.prompt`, not shell command arguments.

With a configured `codexDaemons` socket, a **new** Codex thread is allocated and named using the existing daemon, then its first CLI owner is launched by Herdr with `resume <new-id> --remote unix://<socket>`. Model/provider selection happens on the newly allocated thread. No second app-server is launched and no existing CLI-owned session is resumed. A native thread ID is journaled before Herdr launch. Relay verifies that Herdr reports that same identity before delivering the first message. Shared-daemon title linking still verifies terminal identity as documented in DEPLOYMENT.md.

Migration `004-launches.sql` records a launch request before mutation. Repeating an ID returns its original receipt; changing its payload is rejected. Gateway restart turns unfinished launches into **uncertain**. Lost native or Herdr replies are not blindly retried. A tab or unused native thread may remain after a failed launch; inspect sessions before deliberately starting another. The form preserves the request for recovery. It does not silently replay the first message after a crash.

Fred validation: native Codex, Codex through CFRproxy, and Claude Code through CFRproxy were launched in a chosen CWD and returned exact test replies with their selected models in native transcripts. Browser creation, swipe navigation, uploads, approvals, queue, reconnect, and streaming are covered by Playwright. OMP/Pi and DSH native integration are separate outstanding work; the launcher does not claim interactive support for them merely because Herdr can start a binary.

Live native steering was also verified on Fred: an existing Codex turn received `turn/steer` with its `expectedTurnId` and produced the changed final reply without a new turn.

### Host prerequisites and launch permissions

The gateway service must have write access to every configured project root for **New project folder** to work. `ProtectHome=read-only` alone blocks this even when ordinary shell permissions allow creation. The service template grants `ReadWritePaths=%h` for projects directly beneath the user's home; installations restricting projects to a dedicated directory should grant only that root plus Relay's state directory. API realpath/root validation still applies.

Codex remote launches require the installed CLI to support `codex resume --remote`. Check the binary reached by the Herdr shell, including broken symlinks earlier in PATH: an older system Codex can silently become the fallback. On Fred, a removed standalone package left `~/.local/bin/codex` dangling; the still-running 0.162.1 executable and code-mode host were recovered from their `/proc/<pid>/exe` handles to restore the original installation path without interrupting existing sessions.

For native-daemon launches, permissions are applied exactly once through `thread/start`. Do not append sandbox/approval CLI flags to `resume --remote`: Codex rejects those overrides. Direct CLI launches still receive their configured permission flags.
