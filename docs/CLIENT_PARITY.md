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
| Questions, approvals, stale request handling | Implemented | Implemented | Same interaction API; existing CLI Codex question routing remains an adapter limitation, not a client feature |
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
