# Web and Android feature parity

Both clients are first-class Relay clients. A user-facing feature or fix must be reviewed against both implementations before it is called complete. Equivalent outcomes matter; native clipboard, Android Back and browser installation use different platform APIs.

## Source audit, 2026-10-09

“Implemented” below describes code coverage, not a claim of physical-device or every-harness verification. All control operations require gateway capabilities and the correct ownership mode.

| Workflow                                                          | Web                                   | Android APK                         | Evidence / gap                                                                                                                        |
| ----------------------------------------------------------------- | ------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Session search, harness filter, profile/model/CWD, saved sessions | Implemented                           | Implemented                         | App.tsx / RelayApp.kt, Protocol.kt                                                                                                    |
| Recency-first session list (last opened or agent activity)        | Implemented                           | Implemented                         | Client-local open timestamps; pinned sessions remain above the chronological list                                                     |
| Rename, pin, archive, supported turn interruption                 | Implemented                           | Implemented                         | SessionActions / Screens.kt                                                                                                           |
| Start session, folder selection, DSH profile, model/custom model  | Implemented                           | Implemented                         | NewSession.tsx / LaunchScreen                                                                                                         |
| Send, Steer, explicit Queue                                       | Implemented                           | Implemented                         | Gateway messages API is authoritative                                                                                                 |
| Outgoing chat bubble remains until native transcript echo         | Implemented                           | Implemented                         | A gateway-accepted receipt alone no longer hides the message                                                                          |
| Appearance theme and accent palette                               | Implemented                           | Implemented                         | Both have system/light/dark and persistent teal, blue, violet, and amber accents                                                      |
| Uncertain delivery recovery                                       | Retains card, Restore draft / Dismiss | Durable original-key Retry safely   | Gap: web does not yet provide the equivalent original-key retry control; Restore draft must not be described as safe retry            |
| Questions, approvals, stale request handling                      | Implemented                           | Implemented                         | Same interaction API; native request_user_input supported on verified CLI Codex; other async formats and CLI approvals remain limited |
| Queue edit, cancel, pause/resume                                  | Implemented                           | Implemented                         | App.tsx / QueueScreen                                                                                                                 |
| Reorder pending tasks                                             | Implemented                           | Missing                             | Add native reorder controls against the existing gateway route                                                                        |
| Model and session permissions                                     | Implemented                           | Implemented                         | Capability gated; confirm permission changes                                                                                          |
| Restart exact conversation with another provider                  | Implemented                           | Implemented (0.1.18+)               | Long-press → Swap provider; local Claude/Codex only; see PROVIDER_SWAP.md                                                             |
| File/image upload, previews, download                             | Implemented                           | Implemented                         | Native keyboard image insertion is Android-specific; browser permission/platform restrictions remain                                  |
| File saves survive disappearing message rows                      | Browser-managed                       | App-root picker/ViewModel (0.1.18+) | Fetch and validate before opening picker; physical system-picker check outstanding                                                    |
| Dictation, cleanup, editable result                               | Implemented                           | Implemented                         | Shared gateway speech service; never auto-send                                                                                        |
| Streaming, earlier history, reader scroll preservation            | Implemented                           | Implemented                         | Browser and native regressions are separate                                                                                           |
| Native task-notice formatting and source timestamps               | Implemented                           | Implemented                         | Shared TS behavior has a separate Kotlin implementation: test both for format changes                                                 |
| Tailnet access                                                    | Implemented                           | Implemented                         | Gateway authorization remains mandatory                                                                                               |
| Off-tailnet device pairing                                        | Implemented                           | Missing                             | Android currently fails closed outside authorized tailnet access                                                                      |
| Notification preferences | Questions, completions and failures while open | Opt-in background Tailnet service, category channels, privacy and session links | Native direct push requires Tailscale and unrestricted battery use; closed-browser Web Push is not implemented |
| Installation/update                                               | PWA install and APK download          | Signed APK installation             | A web deployment cannot update installed Kotlin code                                                                                  |

## Change and release contract

1. Inspect both clients for each changed workflow; update this matrix for an intentional gap, with its reason. Do not mark “parity” solely because both use the gateway.
2. Preserve the same Send/Steer/Queue semantics, request IDs, exact interaction routing, authorization, and draft recovery. A new gateway response field must remain compatible with older installed APKs.
3. Add equivalent behavioral regressions for shared bugs. Use browser tests for web and Kotlin/instrumentation tests for native; one cannot substitute for the other.
4. Run web checks and Android unit/lint/build checks. Run relevant browser and disposable-emulator flows for behavioral changes. Record physical-device checks separately. Both CI workflows run for every push/PR, including gateway-only changes.
5. Release web/gateway changes and, when native code changes, increment/sign/publish the APK too. State the deployed gateway commit, APK version, tests and remaining differences. Never claim a refresh updates the APK.

Priorities: original-key web retry, Android queue reorder, then notification preferences. Off-tailnet pairing is lower priority for the current tailnet-only deployment. Native background push requires its own infrastructure and verification.

## Verification for this audit

Gateway regression suite: 94 passed. TypeScript, ESLint and production web build passed. Android unit tests, lint and debug build passed against unchanged native sources. Browser receipt tests cover confirmed-without-echo recovery, preservation of a newer draft, zero message POSTs during recovery, transcript reconciliation and reload persistence. Native receipt recovery has its separate 0.1.3 instrumentation regression; instrumentation and physical-phone tests were not rerun for this web-only change.

### Native Stop, 2026-10-09

Existing web and Android Stop controls now receive `interruptTurn` for verified CLI Codex daemon links and native DSH sessions. Web: session actions → Stop current turn (also session details). Android: hold a session → Stop current turn, or Session details → Rename, pin or manage session. Confirmation is required. No new APK is needed for these server-advertised capabilities. Codex selects the exact active turn after ownership verification; DSH uses the existing host's `session/cancel` and preserves its pending inbox. This does not terminate a Herdr process or erase queued tasks. Claude CLI interruption remains unsupported until a safe native route is integrated.

### DSH delayed transcript echo and permissions

An accepted DSH prompt is not necessarily present in the native transcript yet. Web and Android retain the local outgoing bubble until the native `user/message` event is observed; gateway acceptance alone no longer removes it. Android also renders the message text during the request, instead of showing only a spinner. DSH may delay applying a steer until a supported agent step. Permission presets are session-scoped, but a sandbox switch is rejected while that agent owns open or starting persistent terminal sessions; close them in DSH and retry. Relay never closes those sessions automatically.

Validation: 96 backend tests passed, including exact Codex turn cancellation, rejected stale/replaced owners, DSH idle/missing-session rejection and cancellation acknowledgement. Browser Stop confirmation/route test passed. Native UI code did not change; physical-device Stop validation remains outstanding.

Codex cancellation follows the [official app-server turn/interrupt contract](https://learn.chatgpt.com/docs/app-server), additionally checked against the installed 0.162.0 JSON schema. DSH cancellation was checked against the installed `session-controller` source; it acknowledges cancellation and retains the native inbox.

### Native Codex questions and session settings, 0.1.4

The permissions route uses the adapter contract instead of a DSH-only class check. Verified existing Codex daemon connections expose only allowed native profiles. Custom policies have a stable snapshot identity and a readable label; selecting a preset uses `thread/settings/update`, with ownership checks, confirmation, serialized updates and read-back confirmation. The separate `/mode` route exposes Build/Plan, preserves the model/reasoning effort, and does not modify the permission profile. Both settings apply to subsequent turns.

Web and Android Session details have separate permission and mode controls. DSH retains its existing native permission presets. DSH mode and Claude CLI permission/mode changes remain unsupported. No slash-command chat workaround is used. Codex reads/subscriptions attach to the existing loaded daemon with `thread/resume` without configuration overrides. No second app-server is started.

Existing CLI Codex sessions now receive native `item/tool/requestUserInput` cards. Relay responds using the original JSON-RPC request ID and waits for `serverRequest/resolved`. Replayed requests deduplicate; external answers remove cards; dropped-response delivery becomes uncertain rather than automatically resending. Native questions remain available while the server keeps them pending. A reconnect resubscribes and recovers outstanding requests. This pathway does not claim support for arbitrary dynamic tools, every async question representation, or native CLI command/file approvals.

Live verification used an isolated Codex thread: a genuine request_user_input question appeared, replayed on a second connection after reconnect, accepted the exact structured answer and emitted resolution. Separate profile and mode changes were confirmed through native read-back on that test thread. User sessions were not used for test mutations.

Validation: 104 backend tests pass; TypeScript, ESLint, production web build, Android unit tests, lint, debug/test APKs and signed 0.1.4 build pass. Two phone-size browser regressions verify independent Plan confirmation and exact Codex question responses with no chat submission. Native emulator results and release status are recorded in ANDROID.md. Physical-phone checks remain outstanding.

### Codex embedded image previews

Codex native tool output containing inline PNG/JPEG/WebP/GIF data is imported as an `artifact.created` attachment. Both clients use their existing authenticated preview/download flow; installed APK 0.1.4 needs no update. Native source IDs prevent duplicate transcript entries on replay, artifact request fingerprints prevent duplicate files, and native timestamps are retained. Base64 is removed from persisted event data. No model-provided URL is fetched and no arbitrary filesystem path is read. Historical images are backfilled during transcript replay and may appear at the end of existing history. Existing transcript size and attachment quota limits still apply.

Validation: 105 backend tests, TypeScript, ESLint, production web build, Android unit/lint/debug build, and the phone-size browser artifact preview/download/replay regression pass. No Android UI code changed; physical-device verification remains outstanding.

### Recovering native Codex steering

CLI-reported native IDs now participate in daemon binding discovery instead of being skipped. Existing IDs still require process/title proof before controls are advertised; an unverified pre-existing ID is retained for conversation reading. Herdr CLI adapters refresh their native callbacks each discovery cycle while retaining their transcript reader, enabling controls after late binding and withdrawing them when the link is lost. Both clients consume these live capabilities; APK 0.1.4 needs no update. Ready sessions no longer carry the generic transport diagnostic (which incorrectly mentioned Claude approvals on Codex). Unavailable steering instead has a short actionable status.

Regressions cover pre-registered native IDs, late link acquisition/loss, preserved reader cursors, and routing Steer to the native callback. Android's existing capability gating remains unchanged; physical-phone validation remains outstanding.

Validation: 107 backend tests, TypeScript, ESLint, production web build, two mobile browser Send/Steer regressions, and Android unit/lint/debug build pass.

### Project folders and launch permissions, Android 0.1.5

Web and Android New session provide **New project folder**: a single folder name creates a private directory directly under the profile's first permitted root (Fred: `/home/crogers2287`) and selects it as CWD. Separators, hidden names, traversal, and collisions are rejected. Existing folders are never overwritten. The administrator-only endpoint is rate limited and audited; on Linux an open parent directory anchors the creation against concurrent path replacement.

Launch permissions are server-provided choices. Claude/Codex choices are trusted installation configuration, exposed without command arguments; DSH choices come from its native permission catalog. A selected choice requires explicit confirmation. Codex configures the new native thread and its sole Herdr CLI owner consistently; Claude receives the selected native CLI flags; DSH applies and reads back the preset before the first prompt. An unconfirmed or unknown choice is rejected before a launch claim. Permission failure never falls through to sending the first instruction. Host defaults are unchanged when no choice is selected.

Existing session permissions and mode controls are at the top of Session settings. Codex and DSH support adapter-backed changes; existing Claude CLI permission changes remain unavailable without a safe native interface. Claude Plan/Accept edits/Bypass can be selected when creating a new session. This release requires APK 0.1.5 for the new native screens; web updates independently.

Validation: 109 backend tests, production web build/typecheck/lint, Android unit/lint/debug and test builds, 14 emulator integration tests (including actual keyboard/clipboard paths), and mobile browser launch/settings regressions. Screenshots reviewed for native launch and keyboard layouts. Physical-device checks and live launch-policy verification across every harness remain outstanding.

### Codex native approvals (2026-10-10)

Existing Herdr-owned Codex sessions now forward native command/file approvals as
interaction cards, alongside structured questions. Both clients render the offered
one-time decisions; session-wide and persistent policy grants are not offered by
these cards. Responses use the original JSON-RPC request ID and wait for native
resolution, never send a chat turn. Command-specific `availableDecisions` is
respected (some requests permit Cancel instead of Decline). Unsupported server
request methods remain unsupported.

### Chat links (Android 0.1.6)

Web Markdown download links were already functional; a mobile browser regression
now checks download filename and preserved conversation navigation. Android now
opens HTTP(S) Markdown links through the system browser while preserving long-press
selection. Android's release is still tailnet-authenticated; external-browser downloads
use that same tailnet access. Neither client exposes arbitrary server filesystem paths.
Validation: 111 backend tests, 2 targeted mobile browser tests, 16 native emulator
tests, Android unit/lint/build. Physical-device download/install remains a user check.

### Browser downloads from chat

Native chat opens HTTP(S) links in the system browser, which does not inherit app credentials. When Tailscale is configured, unauthenticated GET/HEAD requests for APKs and published conversation attachments/media on the configured public host redirect to the configured private endpoint. Query parameters are discarded. The private endpoint still authenticates the Tailscale peer and enforces session read access. Other API requests and mutations continue to reject missing authentication. This gateway fix applies to existing Android installations and web links without an APK update.

### Codex bypass policy (Android 0.1.8)

Codex sandbox access and approval policy are independent. The built-in Full access / bypass approvals choice now sets `permissions: ":danger-full-access"` and `approvalPolicy: "never"` together. Read-back must confirm both full access and approvals never; a full-access profile with on-request approvals is shown as a custom policy. Workspace and Read only restore on-request approvals. Custom native profiles are not assigned an inferred approval policy.

Both clients explain that changes affect subsequent turns. Existing running turns and pending approvals retain their previous policy; Relay does not automatically approve pending requests. Android also propagates normal settings-load coroutine cancellation instead of displaying it as a failure.

### Composer lifecycle (Android 0.1.7)

Android consumes the submitted draft and its original transcription after durably
saving the outgoing request, before waiting for the network. Failed delivery restores
them only if the user has not edited the next draft. Retry keeps the same request ID
and the exact original draft (including whitespace). A confirmed receipt for an
accepted message cannot clear a newer identical draft. Dictation originals are saved
with their session's draft and do not leak across session switches.

Web clears the completed dictation panel on successful Send/Steer/Queue, scoped to
the submitted recording generation so a later recording is preserved. Browser tests
cover real recording into a draft, sending, clearing the original, and preserving new
text during acknowledgement. Native tests cover immediate clearing, late receipt,
failed delivery, whitespace retry, and activity recreation.

Verification for this change: 111 backend tests, typecheck/lint/web build, the mobile
browser recording/send regression, 18 Android emulator integration tests, and native
unit/lint/debug builds passed. The emulator checks include real clipboard, Back,
recording, and interaction routing; a physical phone remains a separate check.

### Activity consolidation (Android 0.1.9)

Android now matches web's consecutive tool/reasoning grouping. Each run has a single collapsed Agent activity disclosure with an event count, a 48dp minimum target and an expanded/collapsed accessibility state. Expansion is keyed to the first native event, so appended activity preserves it. Messages, artifacts, file changes and plans remain outside the group; pending questions and approvals retain their dedicated cards. Raw events, timestamps and ordering are unchanged.

### Long dictation decoding

Gary's shared ASR upload decoder now uses a seekable anonymous temporary file instead of piping M4A into FFmpeg. A 40-second spoken M4A reproduced a zero-byte decode and HTTP 200 with empty text before the fix. The same bytes decode correctly with seeking. Both Android M4A and browser WebM regression cases cover 6, 40 and 180 seconds. Invalid, empty and oversized input is rejected. See `scripts/speech/README.md`; neither client needs an update for this service-side repair. End-to-end speech verification is separate from decoder validation.

### Codex asynchronous questions

Codex exposes `request_user_input_async` through native `agentMessage` items with `delivery: async` and structured `questions`, separately from the JSON-RPC `item/tool/requestUserInput` pathway. Relay reads full active-turn history (summary history omits answers), renders these through the existing web/Android question cards, and recognizes structured answers from other clients. Stable question identity matches Codex's `[tool name, item id, question index]` tuple. Replies use the native `send_user_message_question_reply` envelope via `turn/steer` with the exact expected active turn ID, as in Codex's own TUI. Ended/replaced turns and already answered questions cannot be submitted. Durable broker claims protect double submissions and uncertain delivery; the adapter never starts a new turn to answer an async question.

Protocol references: installed experimental app-server schema (`AsyncUserInputQuestion`, `TurnSteerParams`) and upstream `codex-rs/tui/src/chatwidget/questions.rs`, `codex-rs/tui/src/bottom_pane/async_questions/state.rs`, `codex-rs/context-fragments/src/answered_question.rs`. Native screenshots still require device verification; both clients already support this structured question shape.

Live question polling runs before transcript import, so malformed or unavailable history cannot hide pending native requests from either client. Large JSONL histories replay in bounded 4 MiB reads instead of failing permanently above 128 MiB; native event identities still deduplicate replay after restart. Regression coverage includes failed-history question discovery and a 129 MiB history replayed across adapter restarts.

Android 0.1.10 adds explicit recovery controls for saved launch receipts: check again, view sessions, and return to the preserved form after confirmation. Only a starting/checking request shows indefinite progress; uncertain receipts stop the spinner. Returning to the form never sends or retries a launch automatically. Web already provides launch-recovery controls.

The primary checklist button now opens **Agent tasks** on web and Android. Both read the latest structured plan from session detail, independently of transcript pagination, and show pending/in-progress/completed steps. Codex plan events/update_plan and Claude TodoWrite are supported; other harnesses need to emit a normalized plan event. No prose-derived or guessed plan is displayed. Queued messages remain a secondary action. Backend extraction and mobile browser rendering are tested; native recovery instrumentation is compiled, with physical-device execution still outstanding.

## Native Codex delivery and model selection, 2026-10-13

Verified Herdr-owned Codex sessions now submit idle messages and queued tasks through `turn/start` on their existing daemon connection. New Codex launches use the same native first-turn path. Herdr retains process and terminal ownership; Relay does not start a second app-server. Native turn IDs and unique message markers reconcile lost acknowledgements without resending; the markers are removed from displayed messages and replaced with durable task identities.

Both clients expose **Session settings → Session model** when the adapter advertises `changeModel`. Codex uses its native catalog and verifies `thread/settings/update`; DSH uses its existing model interface. A model change preserves planning mode, permissions and instructions. If the previous reasoning effort is unsupported by the selected model, Codex uses that model's advertised default. An active turn retains its current model. Switching Codex providers inside an existing thread is not offered. Claude and other adapters without a native model setter do not advertise this control.

Android requires the signed 0.1.14 update. Its settings load models independently of permissions, and pending messages say **Accepted · awaiting native conversation** until an actual transcript echo arrives. Web model selection is available after refreshing the deployed app.

Validation: 131 backend/shared tests, TypeScript, ESLint, production web build, Android unit tests/lint and signed APK build passed. A phone-size browser test applies a native catalog choice. A disposable Codex session launched under Herdr on Fred received and answered immediately, switched models while preserving permissions, and recovered a discarded send acknowledgement without another submission. Its test tab was closed afterward. The native model-picker instrumentation regression compiles; it was not run because the available emulator is offline. Physical-phone UI verification remains outstanding.

## OpenUI responses and media, 2026-10-13

Web and Android 0.1.15 render the same explicit OpenUI response format and `.openui` publications, with the full installed component library. User actions add a reviewable draft; no tools or approvals run from generated UI. Web loads the larger renderer only when a rich response appears. Android bundles an isolated artifact surface while keeping its editor/navigation and media playback native. See [OPENUI.md](OPENUI.md) for the security boundary and unsupported pipeline execution.

Both clients map DSH Markdown filesystem links to exact authorized conversation files, support video/audio playback, and download files instead of opening the SPA. Image indices remain compatible with older versions. Passive media routes implement byte ranges and never render HTML/SVG inline. File size remains 20 MB. Phone codec, save-picker and embedded artifact gesture verification remains a physical-device check.

Browser chat now has one scroll owner: row measurement preserves the reading anchor and bottom-follow updates are coalesced into one animation frame. Native Android retains its existing native scroll behavior.

Verification for this release: 47 browser end-to-end checks passed, including media playback/seeking, exact byte downloads, rich form drafts/replay, keyboard-sized composition, and reading-position preservation. Android has 17 passing unit tests, lint and compiled instrumentation tests, with a signed 0.1.15 APK. The disposable emulator system-image directory is empty, so native playback/embedded-artifact runtime verification remains a physical-device check. The actual DSH coheed MP4 was read successfully through its authenticated native file API (12,313,078 bytes, video/mp4).

Recovery now settles an uncertain message when its durable receipt is confirmed while retaining one visible bubble until the native echo arrives. Public JS/CSS/icon requests no longer consume the agent API rate quota, preventing blank reloads during heavy use; the API quota remains enforced and regression-tested.

### Agent tasks and linked sub-agent viewer (Android 0.1.16)

Tasks reads native Codex plans and Claude/DSH todo tools, including DSH's `todo_write`. DSH history imports through the existing transcript route and watcher. The checklist remains separate from queued user instructions. Both clients expose **Agent tasks → Sub-agent conversations**, with a parent-scoped catalog, read-only messages, collapsed tool activity, timestamps and earlier-history paging. Polling refreshes child transcripts without scrolling to the bottom.

The viewer supports Codex `session_meta.source.subagent.thread_spawn.parent_thread_id` and Claude's `<parent-session-id>/subagents/agent-*.jsonl` folder. It never matches by project name or CWD. All reads require authorization for the parent; child IDs cannot become controllable sessions. Source identities and ordering are reconstructed from durable native transcripts after restart. Catalog refresh is bounded to once a minute; up to 100,000 normalized events per child and 32 cached child histories. Original Herdr processes remain untouched. DSH/OMP/OpenCode/Hermes child linkage is not advertised as supported. Child attachment downloads and interactive OpenUI actions are not supported in this viewer yet. Native device rendering/Back gestures still require physical-phone validation.

Navigation detail: Android child Back returns to the child catalog; the web child screen has an explicit **All sub-agents** control while its page Back returns to the parent conversation.

### Claude AskUserQuestion (Android 0.1.17)

Web and Android recognize choice-batch metadata on Claude's exact hook interactions, preserving descriptions, multi-select and custom replies. The shared session view reports blocking native interactions as blocked, rather than working. Web regression coverage verifies options and exact batch responses; native unit/lint/build and real Claude headless hook roundtrip pass. Older APKs receive a compatible question list and their legacy answer format remains valid; 0.1.17 adds the full multi-select batch UI. Real terminal concurrent answering and physical phone rendering remain separate checks.

### Definite pre-dispatch rejection and uncertain delivery recovery (Android 0.1.20)

Both clients keep drafts editable when the gateway positively rejects a message before native dispatch (including HTTP 422 for idle-to-busy races). This differs from transport uncertainty, which retains the original request identity and must never automatically resend. Web restores an empty composer and removes the rejected optimistic bubble; Android preserves its durable draft. The gateway marks dispatch attempted only after queue and attachment preflight pass.

Android 0.1.20 adds **Keep draft / clear notice** for an uncertain receipt. Its confirmation explains that the agent may already have received the message. This only dismisses local delivery state, preserves the draft, and sends nothing. Web already provides separate **Restore draft** and **Dismiss** actions. Physical-phone confirmation and draft recovery remain unverified; unit/lint/release builds do not establish device behavior.

## QOL command center and reading controls — 2026-10-14

Both clients now expose a session command center with native model/permission/mode controls, connection state, current plan step, task progress, sub-agent navigation, pending questions, provider restart and supported turn interruption. Provider attribution is shown only when a successful launch/restart receipt matches the current native owner; unknown providers are explicitly reported as unknown. Existing unsupported harness controls remain unavailable.

Both clients offer persistent accent/theme selection including AMOLED, text sizing, compact/comfortable spacing, optional haptics and Responses/Grouped/Everything activity views. Android combines the chosen size with system font scaling; web uses root font sizing and normal browser zoom. Browser vibration depends on platform support. Question trays remain outside the filtered activity list and expired requests stop being actionable locally.

Both retain authenticated inline media and image zoom, and add text/code document previews (256 KB preview limit) and sharing. HTML source is displayed as text, never executed. Binary documents such as Office files remain downloadable/shareable rather than claiming a universal document renderer. Web uses the system file share sheet where supported and falls back to download; Android shares a temporary FileProvider URI with a read grant and cleans old shared files after seven days.

Web pending sends are now durable across browser restarts and use the original request key/payload for manual safe retry, preserving a newer draft. Android retains its existing durable outbox. Transport delivery is distinct from a subsequent observed agent response. Native transcript echoes reconcile optimistic bubbles; no retries run automatically.

Validation and release evidence are tracked in QOL_IMPLEMENTATION.md. Browser fixture tests do not establish physical Android clipboard, microphone, share-sheet or keyboard behavior.

### 0.1.22 native validation and delivery recovery

A confirmed gateway receipt now moves an uncertain Android message to accepted and unlocks the composer. Its bubble remains until native history acknowledges it. Recovery preserves newer drafts and transcription text and never resends the request automatically, matching web receipt recovery.

All 23 instrumentation tests passed on a disposable Android 15 x86_64 emulator, including native clipboard/IME image input, Back, keyboard insets, question responses, delivery recovery, dictation drafts, model controls and settings persistence. A strengthened late-receipt/new-identical-draft test also passed separately. Added coverage for AMOLED/reading/activity/spacing/haptic preference persistence and pending-question visibility/expiry with responses-only filtering. Native keyboard-open/closed screenshots were reviewed. Unit tests, lint and debug/test builds passed. Physical-phone share targets, vibration and OEM keyboard/font behavior remain separate checks.

2026-10-14 notification update: native 0.1.23 adds private background delivery over Tailscale with durable replay, notification categories/privacy, pending-question cleanup and session/answer-tray navigation. Web also recognizes `turn.completed` while running. No FCM credentials or third-party relay is required. Android's quiet foreground connection and battery configuration differ from browser foreground-only notifications; see ANDROID.md. Validation: 166 backend tests and 25 Android runtime tests passed, plus native unit/lint and TypeScript/ESLint checks.

### Local native-file download fix — 2026-10-14

Gateway `7e207bb` fixes the shared media endpoint used by Android and web inline links and file cards. Previously the endpoint required a DSH host even for Codex/Claude references. Explicit assistant file references on configured `localFiles` hosts now resolve locally; remote DSH reads retain their native transport. Authentication, session/event/native-session binding, a 20 MB limit, bounded regular-file reads and attachment disposition remain enforced. Missing files and symlinks fail cleanly.

Validation: 167 backend tests, TypeScript and ESLint passed. Live Canna Sol downloads returned HTTP 200 and byte-for-byte matches for `SUMMARY.md` (4,644 bytes) and `manifest.json` (2,795 bytes). No client sources changed; installed APK 0.1.23 uses the repaired endpoint without an update. Phone tap behavior was not rerun on a physical device.

### Reader-controlled scrolling — 2026-10-15

Web and Android now pause bottom-following as soon as the reader touches the conversation or scrolls it. Reaching the bottom through a layout change or scroll gesture does not resume following; use Latest messages to resume. This closes the touch-down/delayed-scroll race on Android and prevents web scroll events from silently re-pinning the reader. The web virtualizer only compensates resized rows fully above the viewport, not the partially visible row being read.

Validation: browser live-stream regression passed, including a synthetic layout-induced bottom scroll; Android emulator reader-position regression passed for incoming messages/tools, repeated status refreshes, explicit Latest messages, and touch-down before drag recognition. Android unit tests, lint, debug and signed release builds passed; TypeScript, ESLint and web production build passed. APK 0.1.24 is required for the native fix. Physical-phone behavior still needs confirmation.

### Server-independent APK — 2026-10-15

Android 0.1.25 has no embedded gateway origin, tailnet hostname or IP, and its build script no longer provisions a build machine's Tailscale identity. Fresh installs open server setup; saved explicit HTTPS origins survive upgrades. An optional runtime Tailscale IPv4 fallback applies only to the configured hostname while retaining normal certificate verification. Foreground chat and background notifications use the same configuration. Connection settings are at the top of Settings; host labels and launch directories use the gateway's catalog instead of Fred labels. Absolute external links also work without a configured base origin.

Switching origins cancels old requests, ignores old socket callbacks, resets the live selection/notification cursor, and scopes conversation caches, drafts and pending launch receipts to their server. Legacy drafts and launch receipts migrate to the previously saved origin. Web already uses its current origin and server-provided hosts; no web behavior change was required.

Validation: final full Android integration run passed all 26 tests, including new-install setup, saved-origin restart, keyboard insets, native Back, links, image insertion, recording, interaction replies, notification delivery, and uncertain message recovery. Unit tests, Android lint, debug/test builds, signed release build and web artifact-renderer production build passed. The signed APK's bytecode was checked for the former Fred hostname/IP; neither was present. Signed release setup screenshots were inspected with the keyboard closed and open. A separate person's physical phone and tailnet were not available for testing. See ANDROID.md for HTTPS, Tailscale authorization, CFRproxy and Herdr setup requirements.

## Slash commands and shortcuts, 2026-10-17

Web and Android 0.1.26 share the authenticated command endpoint and native routing.
Both offer slash suggestions, a keyboard shortcut menu, Stop/Ctrl+C, Escape,
Yes/Continue/No, session settings, task progress and child viewers. Commands are
not chat prompts or queued work; pending questions use exact answer cards.
Existing drafts and attachments survive quick replies. See
[session commands](SESSION_COMMANDS.md) for native transports and constraints.
The APK update is required for native menus/navigation. Shared backend handling
alone does not add these controls to older APKs. Android instrumentation was
compiled but cannot run with the currently missing disposable-emulator image.

### Claude plan approvals and questions (2026-10-17)

The shared Claude question hook now handles `ExitPlanMode` as an exact native tool
interaction, alongside `AskUserQuestion`. Both clients receive the existing
approval card with **Approve plan and continue** / **Keep planning** choices and
the supplied plan text. Approval returns the unchanged tool input paired with
`permissionDecision: allow`; rejection returns `deny`. Neither choice sends a
chat turn or changes the session's permission policy. The steering mailbox skips
these interactive tools so queued steering cannot contaminate the question.
The PermissionRequest fallback used by already-running clients also returns
`updatedInput` for approved `ExitPlanMode` requests; a bare allow is insufficient
for this interactive tool in current Claude Code.

The installer registers the narrow `AskUserQuestion|ExitPlanMode` matcher and
preserves unrelated hooks. Existing hook commands use the `current` release path,
so the fallback fix applies without restarting a working harness. A Claude
process that snapshots hook matchers may need its normal hook reload or next
resume to acquire the expanded PreToolUse matcher. An already-dismissed hook
cannot retroactively receive an answer; do not manufacture a replacement question
from transcript prose or bypass the native prompt with terminal keys.

Tests cover both plan decisions through the standalone script/socket, unchanged
plan input, exact response validation, approval capabilities, no extra chat/task,
legacy PermissionRequest output, question batches and steering ownership fences.
Both clients use their existing card components; no APK update is required.

Validation: 180 backend tests and the two mobile-browser approval/Claude-question
regressions pass, with TypeScript, scoped ESLint and formatting checks. Android UI
code is unchanged; a fresh physical-device plan-approval check is outstanding.

### Visible running tools (Android 0.1.27)

Web and Android now keep current tool commands visible outside the collapsed
activity history, including when activity preferences hide historical tools.
They show elapsed time and explicitly say no tool result has arrived. After 30
seconds the UI explains that a tool may still be running or waiting for terminal
input. Stop current turn uses the existing native command/interruption route,
preserves a separate draft, and respects connection and capability restrictions.
Exact native tool-call IDs match parallel completions; legacy calls without IDs
are matched only when there is one unambiguous active call. Native turn boundaries
clear activity. DSH invocation IDs are now retained alongside result IDs.

DSH's persistent Bash conversation API normally returns PTY output only when
the command finishes. The optional native observer in `integrations/dsh-terminal.mjs`
reads retained terminal scrollback from the exact live agent through DSH's owned
terminal service while that command is still running. A private Unix socket and
configured `terminalSocket` bind the gateway to that native observer. Both clients
poll the selected working DSH session every three seconds and render its bounded,
control-code-stripped output as plain selectable text. It is not persisted as
chat or interpreted as a question, approval or HTML.

The bridge is read-only: terminal keystrokes are not connected. Users can stop the
current turn and send instructions to the agent; actual structured DSH questions
retain their native cards. Relay never sends `yes`, disables SSH verification,
or invents an approval from an observed terminal prompt. Hosts without the observer
retain the honest no-live-output warning. See DSH_TERMINAL.md for installation.

Validation: 183 backend tests, TypeScript, scoped ESLint, production build, and
three browser checks (390px/1280px current command, exact Stop route, retained
draft, matching completion, reading-position regression) pass. Android unit tests,
lint, debug/test APK builds pass. The additional native UI regression is compiled;
emulator execution remains blocked by the missing disposable system image.
