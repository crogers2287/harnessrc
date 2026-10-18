# DSH terminal visibility

Relay 0.1.27 (Android) and the current web client display running commands and
elapsed time outside collapsed activity. This needs no native plugin. To also see
actual terminal output **before Bash returns**, install the read-only native
observer into the DSH host profile. No second harness or shell process is created.

`integrations/dsh-terminal.mjs` is a Cordis plugin with only Node built-in imports.
It obtains the exact live agent from `ctx.agents`, then lists/reads that agent's
owned terminals through `agent.ctx.terminals`. It never reads a terminal device,
consumes stdin, or writes input. A missing owner is refused; it never resumes a
saved session. The socket permits only `read`, with bounded request/response size
and timeouts. The containing directory must belong to the operator and not be
writable by other users; the socket is mode 0600. This integration requires a
Unix host and the native DSH terminal service. Hosts without those stay usable
with the no-live-output warning.

Prepare the change with your own paths and the DSH host ID from Relay config:

```sh
python3 scripts/install-dsh-terminal-observer.py \
  --profile "$HOME/.dsh/profiles/web" \
  --release "$HOME/.local/share/relay/current" \
  --socket "$HOME/.local/state/relay/dsh-terminal.sock" \
  --gateway-config "$HOME/.config/relay/config.json" \
  --host-id YOUR_DSH_HOST_ID
```

This prints only the proposed plugin entry and gateway binding, not credentials.
Add `--apply` to back up both files and write the narrow additions. Unrelated
profile/config fields are preserved. It never restarts a service. An already
configured observer requires deliberate review instead of adding a duplicate.

Confirm DSH's configuration HMR is active before applying to a running host.
The shipped HMR watches the profile patch and reconciles Loader entries; adding
only this new entry can preserve the existing agents. Verify the observer socket
appears, its plugin fiber is active, and existing native owners remain present.
If the installed DSH version cannot load it live, schedule a DSH restart after
active work and native questions have been resolved. Do not silently interrupt
other agents to activate it. Reload/restart only the Relay gateway to read its
new optional `dsh[].terminalSocket` setting.

Both clients query the authenticated session-detail endpoint every three seconds
while viewing a working DSH session. Output remains bounded, ephemeral and plain
text. Gateway responses verify the native session identity and remove ANSI color
controls; they do not fetch model-provided paths or URLs. The view is retained
scrollback, so it can include earlier commands from the same agent and multiple
owned terminals. It is not a promise that a particular terminal line is the
current tool's prompt.

Terminal input remains unsupported: an SSH authenticity/password prompt is not a
native question card. Read the output, verify any fingerprint using a trusted
channel, and use **Stop current turn** before asking the agent to retry with your
instructions. Structured DSH question/approval cards keep their existing exact
native response path. No automatic trust decisions or shell-key injection.

Validation covers exact owner fencing, unsupported writes, disconnected observer,
terminal text delivery, command/result pairing, stop delivery and draft retention.
Installed-host activation and physical-phone checks must be recorded separately
from fixture tests. Remove this one plugin entry and gateway `terminalSocket` to
roll back; leave existing sessions and other profile configuration intact.
