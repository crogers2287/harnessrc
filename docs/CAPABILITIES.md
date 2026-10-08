# Implemented capabilities and remaining work

“Implemented” means executable adapter code covered by local contract tests, not a claim of live Fred testing. Runtime flags additionally require a valid native session and process binding. Device read grants remove control capabilities.

| Capability | Existing Claude CLI | Existing Codex CLI | Herdr Codex native bridge | Hermes | OpenCode | OMP |
|---|---|---|---|---|---|---|
| Read conversation | Implemented JSONL | Implemented JSONL | Implemented native events | Partial SQLite reader | Partial HTTP reader | Partial JSONL reader |
| Stream conversation | Poll appended JSONL | Poll appended JSONL | Native events, gateway polling | Poll database | Poll API | Poll JSONL |
| Send / queue future turns | Unsupported | Unsupported | Implemented | Unsupported | Unsupported | Unsupported |
| Answer native questions | Unsupported | Unsupported | Implemented requestUserInput | Unsupported | Unsupported | Unsupported |
| Approve / reject action | Implemented PermissionRequest hook | Unsupported | Implemented command/file approval | Unsupported | Unsupported | Unsupported |
| Steer / interrupt | Unsupported | Unsupported | Implemented native protocol | Unsupported | Unsupported | Unsupported |
| Resume session | Unsupported remote operation | Unsupported remote operation | Bridge resumes only its own saved thread | Unsupported | Unsupported | Unsupported |
| Attach files | Unsupported | Unsupported | Unsupported | Unsupported | Unsupported | Unsupported |
| Read diffs / subagents | Unsupported capability flags | Unsupported capability flags | Diff event rendering; flags remain off pending complete contract | Unsupported | Unsupported | Unsupported |

Readers import emitted supported record types; they do not manufacture reasoning. OMP branch records retain ancestry but active-branch reconstruction is incomplete. Hermes/OpenCode integration is validated with local database/HTTP fixtures, not real running harnesses. Discoverability depends on Herdr reporting the native session ID; missing IDs show unavailable capabilities.

## Exact blockers for CLI parity

1. Installed Herdr 0.8.0 `agent.prompt` targets a pane/name without a native-session/process compare-and-set precondition. A check followed by a pane write can race replacement. CLI turn writes and queue dispatch therefore remain disabled. Herdr must provide atomic owner-bound structured dispatch, or the CLI must expose a documented safe writer attachment.
2. Claude PermissionRequest supports tool permission decisions. It does not expose a documented universal remote response route for AskUserQuestion, plan approval, steering, or arbitrary idle input. Hooks must already be configured in the original Claude process; observation does not require a plugin.
3. Existing Codex CLI threads cannot safely gain a second app-server writer. The supported bridge starts a distinct native session owned by its existing Herdr process. CLI-owned interactive parity needs a documented shared connection/ownership protocol.
4. Live credentials, Fred deployment, and genuine agent acceptance are not performed. Installed binaries and generated schemas were inspected locally; no private session transcript or live production prompt was accessed.

Next priorities: run the Fred acceptance sequence; implement a safe native owner-bound CLI transport if upstream supports it; add complete file attachment/diff/subagent contracts; validate Hermes/OpenCode/OMP live readers; test physical devices and native push infrastructure. Browser notifications require an open app; no closed-app push claim.
