# Implemented capabilities and remaining work

“Implemented” means executable adapter code covered by local contract tests, not a claim of live Fred testing. Runtime flags additionally require a valid native session and process binding. Device read grants remove control capabilities.

| Capability | Existing Claude CLI | Existing Codex CLI | Herdr Codex native bridge | Hermes | OpenCode | OMP |
|---|---|---|---|---|---|---|
| Read conversation | Implemented JSONL | Implemented JSONL | Implemented native events | Partial SQLite reader | Partial HTTP reader | Partial JSONL reader |
| Stream conversation | Poll appended JSONL | Poll appended JSONL | Native events, gateway polling | Poll database | Poll API | Poll JSONL |
| Send / queue future turns | Implemented Herdr prompt + native completion | Implemented Herdr prompt + native completion | Implemented | Unsupported | Unsupported | Unsupported |
| Answer native questions | Unsupported | Unsupported | Implemented requestUserInput | Unsupported | Unsupported | Unsupported |
| Approve / reject action | Implemented PermissionRequest hook | Unsupported | Implemented command/file approval | Unsupported | Unsupported | Unsupported |
| Steer active turn | Unsupported | Implemented for proved shared-daemon bindings | Implemented native protocol | Unsupported | Unsupported | Unsupported |
| Interrupt turn | Unsupported | Unsupported | Implemented native protocol | Unsupported | Unsupported | Unsupported |
| Resume session | Unsupported remote operation | Unsupported remote operation | Bridge resumes only its own saved thread | Unsupported | Unsupported | Unsupported |
| Attach files/images | Implemented local file references | Implemented local file references | Implemented local file references | Unsupported | Unsupported | Unsupported |
| Read diffs / subagents | Unsupported capability flags | Unsupported capability flags | Diff event rendering; flags remain off pending complete contract | Unsupported | Unsupported | Unsupported |

Readers import emitted supported record types; they do not manufacture reasoning. OMP branch records retain ancestry but active-branch reconstruction is incomplete. Hermes/OpenCode integration is validated with local database/HTTP fixtures, not real running harnesses. Discoverability uses Herdr native IDs. Configured local shared Codex daemons additionally support verified native-name/title challenges for existing named CLI threads; see DEPLOYMENT.md. Missing or unverifiable IDs show unavailable capabilities. New Claude/Codex sessions support host-folder selection and configured model/provider profiles, including CFRproxy (see SESSION_CREATION.md). Pi control and model switching on running sessions are not implemented yet. DSH now has an authenticated adapter to the existing web host: discovery, structured history, native text streaming, Send, Steer, durable Queue, native provider/model selection and new sessions. It never starts a second host. Native DSH questions/approvals, interruption and attachments remain unsupported. See [DSH integration](DSH.md).

## Exact blockers for CLI parity

1. Existing CLI messages use Herdr's documented `agent.prompt`, after native identity and foreground-process checks. Herdr checks the live foreground agent, refuses blocked agents, and submits text plus Enter in order. The response owner is revalidated. There is no second app-server writer. Herdr 0.8.0 lacks an atomic native-ID precondition: a replacement between the checks and submission can still make delivery uncertain. Such tasks are never automatically resent. Upstream owner-bound dispatch remains a hardening priority.
2. Claude PermissionRequest supports exact tool permission decisions when the running CLI has loaded the hook. A native user message followed by an assistant `end_turn` record completes a queued task. Arbitrary AskUserQuestion, plan approval, and CLI steering still need documented native response routes; they are not advertised as supported.
3. Codex CLI dispatch follows the existing process through Herdr and reconciles canonical user messages plus native `task_complete` events. Rich requestUserInput and command/file approval responses currently require the gateway-owned native bridge; do not attach another app-server writer to a CLI-owned thread.
4. Hermes, OpenCode, and OMP readers remain partial. Their interactive transports are outstanding, as are physical-device testing and closed-app push infrastructure.

Next priorities: complete native CLI question routing and upstream owner-bound prompt preconditions; add complete file attachment/diff/subagent contracts; validate Hermes/OpenCode/OMP live readers; test physical devices and native push infrastructure. Browser notifications require an open app; no closed-app push claim.

See [attachment delivery](ATTACHMENTS.md) for same-filesystem configuration, limits, permissions and native file-reader behavior. Image picker/upload is implemented; verified Codex native steering also passes native localImage inputs. Other delivery paths use local file references.
