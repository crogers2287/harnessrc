# Implemented capabilities and remaining work

“Implemented” means executable adapter code covered by local contract tests, not a claim of live Fred testing. Runtime flags additionally require a valid native session and process binding. Device read grants remove control capabilities.

| Capability                | Existing Claude CLI                                       | Existing Codex CLI                            | Herdr Codex native bridge                                        | Hermes                | OpenCode            | OMP                  |
| ------------------------- | --------------------------------------------------------- | --------------------------------------------- | ---------------------------------------------------------------- | --------------------- | ------------------- | -------------------- |
| Read conversation         | Implemented JSONL                                         | Implemented JSONL                             | Implemented native events                                        | Partial SQLite reader | Partial HTTP reader | Partial JSONL reader |
| Stream conversation       | Poll appended JSONL                                       | Poll appended JSONL                           | Native events, gateway polling                                   | Poll database         | Poll API            | Poll JSONL           |
| Send / queue future turns | Implemented Herdr prompt + native completion              | Implemented Herdr prompt + native completion  | Implemented                                                      | Unsupported           | Unsupported         | Unsupported          |
| Answer native questions   | Implemented AskUserQuestion PreToolUse hook                                               | Unsupported                                   | Implemented requestUserInput                                     | Unsupported           | Unsupported         | Unsupported          |
| Approve / reject action   | Implemented PermissionRequest hook                        | Unsupported                                   | Implemented command/file approval                                | Unsupported           | Unsupported         | Unsupported          |
| Steer active turn         | Implemented documented tool hooks, after process check-in | Implemented for proved shared-daemon bindings | Implemented native protocol                                      | Unsupported           | Unsupported         | Unsupported          |
| Interrupt turn            | Unsupported                                               | Unsupported                                   | Implemented native protocol                                      | Unsupported           | Unsupported         | Unsupported          |
| Resume session            | Unsupported remote operation                              | Unsupported remote operation                  | Bridge resumes only its own saved thread                         | Unsupported           | Unsupported         | Unsupported          |
| Attach files/images       | Implemented local file references                         | Implemented local file references             | Implemented local file references                                | Unsupported           | Unsupported         | Unsupported          |
| Read diffs / subagents    | Unsupported capability flags                              | Unsupported capability flags                  | Diff event rendering; flags remain off pending complete contract | Unsupported           | Unsupported         | Unsupported          |

Readers import emitted supported record types; they do not manufacture reasoning. OMP branch records retain ancestry but active-branch reconstruction is incomplete. Hermes/OpenCode integration is validated with local database/HTTP fixtures, not real running harnesses. Discoverability uses Herdr native IDs. Configured local shared Codex daemons additionally support verified native-name/title challenges for existing named CLI threads; see DEPLOYMENT.md. Missing or unverifiable IDs show unavailable capabilities. New Claude/Codex sessions support host-folder selection and configured model/provider profiles, including CFRproxy (see SESSION_CREATION.md). Pi control and model switching on running sessions are not implemented yet. DSH now has an authenticated adapter to the existing web host: discovery, structured history, native text streaming, Send, Steer, durable Queue, native provider/model selection and new sessions. It never starts a second host. Native DSH live question waterfalls now support exact batched responses, choice/free-text cards and reconnect replay. Native files and image input support Send and Steer when the installed DSH upload route is available. Native presented files and local Markdown images render as authenticated previews and downloads. Command approvals and interruption remain unsupported. See [DSH integration](DSH.md).

## Exact blockers for CLI parity

1. Existing CLI messages use Herdr's documented `agent.prompt`, after native identity and foreground-process checks. Herdr checks the live foreground agent, refuses blocked agents, and submits text plus Enter in order. The response owner is revalidated. There is no second app-server writer. Herdr 0.8.0 lacks an atomic native-ID precondition: a replacement between the checks and submission can still make delivery uncertain. Such tasks are never automatically resent. Upstream owner-bound dispatch remains a hardening priority.
2. Claude PermissionRequest supports exact tool permission decisions when the running CLI has loaded the hook. A native user message followed by an assistant `end_turn` record completes a queued task. AskUserQuestion now has a documented exact PreToolUse response route with choice-batch cards; plan approval remains unsupported. Claude steering now uses documented tool-boundary context hooks in the existing process; see [Claude steering](claude-steering.md). Live text steering was verified on Fred without restarting Claude.
3. Codex CLI dispatch follows the existing process through Herdr and reconciles canonical user messages plus native `task_complete` events. Rich requestUserInput and command/file approval responses currently require the gateway-owned native bridge; do not attach another app-server writer to a CLI-owned thread.
4. Hermes, OpenCode, and OMP readers remain partial. Their interactive transports are outstanding, as are physical-device testing and closed-app push infrastructure.

Next priorities: complete native CLI question routing and upstream owner-bound prompt preconditions; add complete file attachment/diff/subagent contracts; validate Hermes/OpenCode/OMP live readers; test physical devices and native push infrastructure. Browser notifications require an open app; no closed-app push claim.

See [attachment delivery](ATTACHMENTS.md) for same-filesystem configuration, limits, permissions and native file-reader behavior. Image picker/upload is implemented; verified Codex native steering also passes native localImage inputs. Other delivery paths use local file references.

## Read-only linked sub-agent viewer

Claude and Codex now expose a parent-authorized sub-agent catalog and paginated conversation reader through **Agent tasks → Sub-agent conversations** in web and Android 0.1.16. Codex requires explicit `thread_spawn.parent_thread_id` metadata; Claude requires its native parent-owned `subagents` folder. Fred's transcript survey discovered 311 children across 58 readable parent sessions and loaded a real child history. Stable source IDs prevent replay duplicates. This does not add child control or attachment/interactive artifact capabilities. Other harnesses explicitly show that linked child reading is not available.

Task lists include DSH's `todo_write`, Claude `TodoWrite`, Codex `update_plan`/`functions.update_plan`, and native plan events. Free-form prose is not guessed into tasks; Claude's newer TaskCreate/TaskUpdate tools still need separate support.

DSH child sessions (native `origin: subagent`) are read-only in Relay. Their
history and live follow stream use DSH's durable subagent address, including
the native parent ID, child ID and declared mode. Treating these rows as ordinary
sessions produces `session/agent-busy` and prevents the conversation loading.
Relay retains the native ownership boundary: send, steer, queue, cancellation,
question responses, permission changes, attachments and model changes remain
available through the parent workflow rather than direct child controls.
Missing parent addresses fail closed. This gateway capability projection applies
to both web and Android; no DSH host restart or transcript changes are required.

Web conversation text uses natural document flow, with loaded message nodes kept
mounted across scrolling. Markdown element types remain stable across clock and
live-event updates; selecting transcript text suspends bottom following. Browser
anchoring preserves the reading position as content changes. Earlier history is
still loaded explicitly. Chromium desktop and phone-width regression checks cover
mouse selection, selection across many messages, scrolling, incoming deltas, and
clipboard order. The Android renderer is unchanged.
