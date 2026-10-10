# Web and Android feature parity

Both clients are first-class Relay clients. A user-facing feature or fix must be reviewed against both implementations before it is called complete. Equivalent outcomes matter; native clipboard, Android Back and browser installation use different platform APIs.

## Source audit, 2026-10-09

“Implemented” below describes code coverage, not a claim of physical-device or every-harness verification. All control operations require gateway capabilities and the correct ownership mode.

| Workflow | Web | Android APK | Evidence / gap |
| --- | --- | --- | --- |
| Session search, harness filter, profile/model/CWD, saved sessions | Implemented | Implemented | App.tsx / RelayApp.kt, Protocol.kt |
| Rename, pin, archive, supported turn interruption | Implemented | Implemented | SessionActions / Screens.kt |
| Start session, folder selection, DSH profile, model/custom model | Implemented | Implemented | NewSession.tsx / LaunchScreen |
| Send, Steer, explicit Queue | Implemented | Implemented | Gateway messages API is authoritative |
| Confirmed receipt without transcript echo | Implemented in this change | Implemented in 0.1.3 | Browser receipt regression / confirmedReceiptUnlocksComposerWithoutResendingOrLosingNewDraft |
| Uncertain delivery recovery | Retains card, Restore draft / Dismiss | Durable original-key Retry safely | Gap: web does not yet provide the equivalent original-key retry control; Restore draft must not be described as safe retry |
| Questions, approvals, stale request handling | Implemented | Implemented | Same interaction API; native request_user_input supported on verified CLI Codex; other async formats and CLI approvals remain limited |
| Queue edit, cancel, pause/resume | Implemented | Implemented | App.tsx / QueueScreen |
| Reorder pending tasks | Implemented | Missing | Add native reorder controls against the existing gateway route |
| Model and session permissions | Implemented | Implemented | Capability gated; confirm permission changes |
| File/image upload, previews, download | Implemented | Implemented | Native keyboard image insertion is Android-specific; browser permission/platform restrictions remain |
| Dictation, cleanup, editable result | Implemented | Implemented | Shared gateway speech service; never auto-send |
| Streaming, earlier history, reader scroll preservation | Implemented | Implemented | Browser and native regressions are separate |
| Native task-notice formatting and source timestamps | Implemented | Implemented | Shared TS behavior has a separate Kotlin implementation: test both for format changes |
| Tailnet access | Implemented | Implemented | Gateway authorization remains mandatory |
| Off-tailnet device pairing | Implemented | Missing | Android currently fails closed outside authorized tailnet access |
| Notification preferences | Browser notifications while open | Missing | Neither client implements reliable closed-app push |
| Installation/update | PWA install and APK download | Signed APK installation | A web deployment cannot update installed Kotlin code |

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
