# Ubuntu / Fred installation

Run as the Unix account owning Herdr. These steps are supplied for Fred; no access to Fred or its Tailscale network was assumed or attempted.

## Install and configure

```sh
cd ~/harnessrc
npm ci
npm run build
mkdir -p ~/.config/relay ~/.local/state/relay ~/.config/systemd/user
chmod 700 ~/.config/relay ~/.local/state/relay
cp deploy/config.example.json ~/.config/relay/config.json
chmod 600 ~/.config/relay/config.json
```

Edit the example paths, host socket and origin. Use the socket path reported by the installed Herdr integration/environment, especially for named Herdr sessions; do not assume the example default. Keep `listen:127.0.0.1`. Set `origin` to Fred's actual HTTPS Tailscale hostname and `secureCookies:true`. Transcript settings are allowlisted roots; `hermes` is its SQLite file. Optional `opencode[hostId]` takes `endpoint` and `authorizationEnv`; provide that environment variable to the service without embedding credentials in JSON. Bridges take exact `hostId`, `nativeSessionId`, `socket`, `harness`.

```sh
herdr --version
herdr api schema --json > ~/.local/state/relay/installed-herdr.schema.json
RC_CONFIG=~/.config/relay/config.json npm run diagnose -- --live
cp deploy/relay.service ~/.config/systemd/user/relay.service
systemctl --user daemon-reload
systemctl --user enable --now relay.service
```

The user service runs under the same account, isolates write access to its state directory and restarts on failure. Adjust `ExecStart` for the installed Node path and `WorkingDirectory` for your checkout. For boot without an active login, an administrator may enable lingering for this account. Install from the generated archive alternatively: extract to `~/harnessrc`, then `npm ci --omit=dev`; browser assets are already included.

Configure Tailscale Serve to proxy HTTPS to `http://127.0.0.1:4080` using the installed Tailscale CLI's help and current tailnet policy. Do not expose the gateway or Herdr socket on public interfaces. Open the exact configured origin on your phone. Read `~/.local/state/relay/pairing-key` locally and enter it into the first-device form. After pairing, add devices with Settings → Create pairing code. No token should go in chat or a shell argument. Settings supports device revocation and read/control grants.

## Claude: existing CLI observation and permission hooks

Existing native-ID sessions appear automatically. Merge `deploy/claude-hooks.example.json` into the appropriate Claude settings file, preserving existing hooks. Replace `YOUR_USER` and Node path; check that the absolute tsx loader exists. The hook uses the private `hooks.sock` under the configured data directory. Start a new Claude process under Herdr after changing settings; existing processes may require reloading settings according to the installed Claude documentation.

The hook handles PermissionRequest for the listed tools only. It waits for an exact mobile allow/deny decision and returns Claude's documented structured output. Offline/unavailable gateway returns `{}`, leaving Claude's original permission flow. Existing bound Claude CLI sessions support messages and queued follow-ups through Herdr. General Claude questions and steering still need native response transports. File/image attachments require `hosts[].localFiles: true` on a shared-filesystem host; include Read/Glob/Grep in the permission-hook matcher and load the updated settings in the native CLI. The native `/rc` command is never overridden.

## Codex: sole-writer bridge launched inside Herdr

In a Herdr pane in the desired project directory:

```sh
RC_BRIDGE_DIR="$HOME/.local/state/relay/codex-project" \
  node --import "$HOME/harnessrc/node_modules/tsx/dist/loader.mjs" \
  "$HOME/harnessrc/scripts/codex-bridge.ts"
```

Herdr's `HERDR_SOCKET_PATH` and `HERDR_PANE_ID` must be available in that pane. The bridge prints its new native session ID and socket path and reports that ID to Herdr. It generates the installed Codex protocol schema, initializes app-server, and starts a new thread. **Do not point it at an existing CLI-owned thread.** Its data directory is exclusive to that bridge. Codex authentication must already work for that Unix account.

Register the printed values from another shell:

```sh
RC_CONFIG="$HOME/.config/relay/config.json" \
  npm exec -- tsx scripts/rc.ts register fred NATIVE_SESSION_ID NATIVE_SOCKET_PATH
systemctl --user restart relay.service
```

The gateway can restart or phones disconnect while the bridge and agent continue under Herdr. The bridge's pane provides lifecycle/log access; it is not an interactive Codex CLI. Existing CLI panes are separately observable and unchanged. Native bridge process restart can leave execution uncertain: inspect the native thread before deciding how to proceed. Do not resend uncertain work blindly.

## Troubleshooting / backup

```sh
systemctl --user status relay.service
journalctl --user -u relay.service -n 50
RC_CONFIG=~/.config/relay/config.json npm run diagnose -- --live
RC_CONFIG=~/.config/relay/config.json npm exec -- tsx scripts/rc.ts status
```

Offline host: verify socket path, owner and permissions. No transcript: verify native ID and matching allowlisted root. Control disabled: check adapter capabilities, live process identity, bridge registration and device grant. Pending interaction expired: answer via the original harness; never reuse a stale card. Repeated authentication failure: match browser origin/HTTPS and Secure cookie configuration. Blank assets after an upgrade: rebuild and reload the PWA. Uncertain queue entry: inspect native correlation; it intentionally blocks subsequent dispatch.

Back up SQLite with its supported online backup mechanism or stop the gateway first and preserve the database/WAL consistently. Include bridge state separately. Protect backups with private permissions. Stop only the gateway for upgrades; Herdr agents stay running. Retain config and state, replace code/assets, run diagnostics, then restart the service.

## Key-free access from the tailnet

Configure the optional `tailnet` setting with a distinct HTTPS Tailscale Serve endpoint and loopback listener port:

```json
"tailnet": {
  "endpoint": "https://fred.taile5e8a3.ts.net:11543",
  "port": 4081
}
```

Run `tailscale serve --bg --https=11543 --yes http://127.0.0.1:4081`. Keep this separate from the public NPM upstream on port 4080/11443. Do not enable Funnel or point a public reverse proxy at the private listener. That listener trusts the local Tailscale Serve transport; other local host users must be trusted. It uses the actual peer IP that Serve overwrites into X-Forwarded-For and validates it through `tailscale whois`. A public request to the ordinary gateway cannot authenticate by supplying Tailscale headers.

The web app at the public hostname probes this private HTTPS endpoint and uses it for HTTP and WebSocket traffic when reachable and verified. No pairing key or browser credential storage is needed on the tailnet. Outside the tailnet, it retains the ordinary pairing flow. MagicDNS must resolve the private endpoint; browser local-network permission may be necessary. Device revocation still applies to automatically registered tailnet devices. All verified tailnet nodes receive administrator/control permissions, as requested for this deployment. Tailnet ACLs govern who can reach the private Serve endpoint.

## Existing Codex shared-daemon terminals

For local Codex CLI clients connected to an existing shared daemon, add:

```json
"codexDaemons": [
  {"hostId": "fred", "socket": "/tmp/codex-daemon-1000/EXISTING_CONTROL_SOCKET"}
]
```

Use the actual running daemon's Unix socket (`codex app-server proxy --help` describes the control socket). It must be a socket owned by the gateway user with mode 0600. This feature never launches another app-server, resumes a thread, or claims approvals. Native `thread/loaded/list`, `thread/read`, and `thread/name/set` must be supported by the installed version.

Relay chooses candidate named threads from the terminal's title, then **proves** the mapping by setting a random temporary native thread name and requiring exactly one matching title echo from Herdr's existing terminal. It restores the name before enabling control. Names alone and CWD are never identity proof. A SQLite journal restores interrupted probes after restart; a concurrent user rename wins. The original terminal remains interactive. You may briefly see “Relay link …” in its title during verification.

Verification occurs on discovery, every 30 seconds, and immediately before each remote dispatch. Process changes, duplicate terminal echoes, missing native title updates, daemon errors, or thread switches fail closed. This requires named threads and a Codex TUI that forwards native name updates to its terminal title. Unsupported clients remain unbound. Conversations come from native structured transcripts; terminal output is not parsed.

Herdr still performs `agent.prompt`. There is no atomic native-thread precondition in Herdr 0.8.0: a local thread switch in the small interval between the final proof and prompt submission remains a limitation. Lost or ambiguous delivery is never automatically repeated. Exact CLI question/approval routing remains separate work.

The session list, chat header, and details show the last model reported by the native harness. Codex uses thread metadata and turn context; Claude uses assistant-response model IDs. A model selected locally but not yet reported by that harness cannot be inferred; it shows the last reported value or “Model unknown.”

The systemd template uses `PrivateTmp=true`. If Codex's socket is in `/tmp`, expose **only its private directory**, not all host temporary files. For Fred's UID 1000:

```ini
# ~/.config/systemd/user/relay.service.d/codex-daemon.conf
[Service]
BindReadOnlyPaths=/tmp/codex-daemon-1000
```

Then run `systemctl --user daemon-reload` and restart `relay.service`. Adjust the UID/path to the real daemon socket directory. Keep the socket private (0600); never expose it through the public reverse proxy.
