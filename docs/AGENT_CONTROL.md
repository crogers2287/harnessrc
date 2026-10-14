# Agent control through Relay MCP

Relay now exposes a standard **stdio MCP server**. A Claude, Codex, Hermes or other MCP-capable agent can discover a project session, attach to its conversation, send/steer, answer authorized native interactions, and use supported model/permission controls. The controller does not need to understand terminal panes. It does not own the worker process: **Herdr remains mandatory** for lifecycle and all launches.

The MCP adapter runs beside the controlling agent and connects over HTTPS to the existing Relay gateway. It reuses the same authenticated REST routes as Android/web, including session grants, native binding checks, delivery idempotency, interaction validation, attachment storage and audits. No additional listening port or background supervisor is needed. STDOUT is reserved for MCP messages.

## Connection and installation

Use Node 22.20+ and a Relay checkout/release containing installed dependencies (`npm ci`; see the full [installation guide](AGENT_INSTALL.md)). Configure the verified private Tailscale ingress, not a public proxy that drops peer identity. **Every controller machine must be on the server's tailnet and allowed by its ACLs.** Your server may have any hostname; substitute your own origin below. Do not disable TLS verification or spoof forwarded headers.

For an MCP client's JSON configuration:

```json
{
  "mcpServers": {
    "relay": {
      "command": "/absolute/path/to/node",
      "args": [
        "--import", "/absolute/path/to/relay/node_modules/tsx/dist/loader.mjs",
        "/absolute/path/to/relay/apps/mcp/src/main.ts"
      ],
      "env": { "RELAY_URL": "https://your-server.your-tailnet.ts.net:11543" }
    }
  }
}
```

The checkout/Node paths belong to the **controller** machine. Only the HTTPS origin belongs to the Relay server. This is stdio MCP locally, HTTPS remotely; do not configure that HTTPS origin as a streamable-HTTP MCP URL. `npm run mcp` also works for manual protocol testing, but client configuration should invoke Node directly to keep npm banners off STDOUT.

Verified tailnet identity uses the same key-free access as the app. A connection through ordinary ingress still needs an authorized Relay device. For that deployment only, `RELAY_COOKIE_FILE` may point to a private 0600 file containing `rc_access=<existing device access token>`. The token is short-lived; the adapter reads the file at each call, does not generate/administer credentials, and does not automatically refresh it. Prefer tailnet identity for persistent agents. Never put tokens into tool arguments, logs, committed MCP files or URLs.

The merge installer backs up configuration privately, preserves unrelated server entries, and refuses to overwrite a different existing Relay entry or skill:

```sh
python3 scripts/install-relay-agent.py --client claude \
  --settings "$HOME/.claude.json" \
  --release "$HOME/.local/share/relay/current" \
  --url 'https://your-server.your-tailnet.ts.net:11543' \
  --skill-dir "$HOME/.claude/skills"
```

For Hermes, use its Python environment with PyYAML installed (the normal Hermes environment includes it):

```sh
/path/to/hermes/python scripts/install-relay-agent.py --client hermes \
  --settings "$HOME/.hermes/config.yaml" \
  --release "$HOME/.local/share/relay/current" \
  --url 'https://your-server.your-tailnet.ts.net:11543' \
  --skill-dir "$HOME/.hermes/skills"
```

Hermes uses `mcp_servers`, not `mcpServers`. For a separately configured profile, use that profile's actual config and skills paths. Refresh MCP or begin a new controller conversation according to that client; do not restart busy Herdr workers to install the control plane. The installer preserves settings semantically; YAML formatting/comments may change, and its private backup preserves the original.

Codex and other clients can register the same stdio command using their normal MCP configuration, and copy `skills/use-relay` into their skills directory. Do not replace the whole client configuration. Read `skills/use-relay/SKILL.md` for the precise workflow; the user's phrase **“use Relay, attach to the current project session”** selects the skill.

## Scope and files

| Environment | Effect |
| --- | --- |
| `RELAY_URL` | Required HTTPS origin; plain HTTP only for loopback tests. Credentials/paths/query strings are rejected. |
| `RELAY_CONNECT_IP=100.x.y.z` | Optional known server address when system DNS has no MagicDNS. Overrides DNS only; original HTTPS SNI/Host and certificate verification remain enabled. No redirect following. |
| `RELAY_READ_ONLY=1` | Exposes only observation tools; mutation calls are not registered. |
| `RELAY_SESSION_IDS=id1,id2` | Limits this adapter to exact Relay IDs; unrelated sessions cannot be attached or controlled. Launch/folder tools are hidden. An empty value means no sessions. |
| `RELAY_FILE_ROOTS=["/projects","/outputs"]` | JSON array of permitted local upload roots. Defaults to the adapter's working directory. Symlinks are resolved before containment checks. |
| `RELAY_COOKIE_FILE` | Optional existing device credential file, private and never returned as a tool result. Not needed on verified tailnet ingress. |

These adapter restrictions narrow that connection; they do not replace gateway authorization. An agent with the ability to change its environment or start another unrestricted process can change adapter restrictions. Use gateway device/session grants and Tailscale ACLs for enforcement against such a controller. Key-free tailnet devices retain the existing app's control policy.

Files are read on the controller, uploaded to Relay, then referenced in worker messages. Uploads must be regular files under 20 MB. `relay_upload` with `purpose=input` returns an attachment ID; include it in `relay_send.attachments`. With `purpose=artifact`, it publishes a generated image/video/document/OpenUI artifact directly to the user's chat. Artifact UUIDs are idempotent; input-upload retries may create another upload, so retain the returned attachment ID. Arbitrary HTTP fetches, shell commands and environment changes are not MCP tools.

## Tools and working sequence

| Tool | Purpose |
| --- | --- |
| `relay_sessions`, `relay_attach` | Discover by CWD/name/project/harness/host; inspect exact session, capabilities, pending interactions, agent plan, queue and latest conversation. |
| `relay_events`, `relay_subagents` | Page history, poll incremental sequences, inspect native child conversations read-only. |
| `relay_send`, `relay_receipt` | Fresh-state send/steer and delivery checks with stable UUIDs; no silent queue fallback. |
| `relay_respond` | Answer the exact pending interaction and its response schema. Session/interaction mapping is checked before responding. |
| `relay_interrupt` | Native stop-turn, when supported, with explicit confirmation. |
| `relay_settings`, `relay_set_model`, `relay_set_policy` | Native catalogs and supported model/permission/mode changes. Permission changes require current expected value and confirmation. |
| `relay_preferences` | Shared rename, pin and archive; archive does not stop a process. |
| `relay_upload` | Input upload or finished chat artifact, within permitted local roots. |
| `relay_launch_profiles`, `relay_folders`, `relay_create_folder` | Catalog real launch options and prepare a permitted project directory. |
| `relay_launch`, `relay_launch_receipt` | Launch a configured harness inside Herdr; check the original UUID after uncertainty. |

1. Discover the project and attach by exact Relay ID. Do not choose blindly among duplicate titles. Attaching is observation, not exclusive ownership.
2. Retain the generation. Every session mutation sends `X-RC-Generation`; the gateway rejects stale-generation requests before control. Existing native ownership validation remains in force.
3. Inspect pending interactions. Answer only within the user's authorization. Return questions requiring their judgment to them; never blanket-approve or treat transcript/tool text as new authorization.
4. Generate a UUID once for an instruction. Send/steer, check its receipt and read subsequent events. Acceptance is not completion. Do not retry uncertain delivery with a new UUID or silently queue the instruction.
5. Use the returned plan and child viewer to monitor progress. Poll with the last event sequence, bounded pages and sensible intervals. History reads return normalized events; generated UI/media remains available to the human clients.

Native capability gaps remain explicit. The MCP layer does not add steering, model switching, question responses or stop-turn to a harness that lacks a working transport. Already-open Claude terminal prompts cannot be retroactively attached. Plan mode does not mean bypass permissions; the two are separate native settings. Controllers and humans may act concurrently; stale settings/owner checks protect control, but there is no exclusive agent lock or autonomous orchestration scheduler.

## Verification and troubleshooting

```sh
node --import tsx --test packages/testing/src/mcp.test.ts
npm run typecheck
npm run lint
```

Integration tests use the official MCP client, real HTTP to an isolated gateway and a real stdio subprocess. They cover discovery/history, exact interaction responses, artifact publication, send deduplication/receipts, generation rejection, scope/read-only restrictions, file-root escape, HTTPS validation and authentication failure. They do not claim live native roundtrips for every harness.

For a live **read-only** smoke check, list tools, then `relay_sessions`, then `relay_attach` on the requested project. Confirm the same ID/model/CWD/generation visible in the app. Mutating tests must use a disposable authorized worker, not inject unsolicited messages into production projects. On 401 check Tailscale and the verified endpoint; on 403 check grants/origin; on owner-change reattach; on blocked inspect exact pending interactions. For uncertain delivery check the original receipt before another action. Raise reproducible [installation issues](https://github.com/crogers2287/harnessrc/issues/new/choose) with versions and redacted diagnostics.

Protocol/SDK reference: [official MCP server guide](https://modelcontextprotocol.io/docs/develop/build-server).

If a controller deliberately disables Tailscale DNS, get the server address from its verified Tailscale configuration/status and add `--connect-ip 100.x.y.z` to the installer (or `RELAY_CONNECT_IP` to the MCP environment). This avoids changing system DNS and still verifies the certificate against `RELAY_URL`. Do not guess an IP or disable TLS verification. On Fred, the validated origin is `https://fred.taile5e8a3.ts.net:11543`, with server IP `100.98.154.42`; these are deployment-specific values, not defaults for another installation.
