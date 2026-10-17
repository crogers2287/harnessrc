# Relay quality-of-life delivery

Requested 2026-10-14. Completion requires implementation and verification on web and Android.

- [x] Session command center: model/provider/permissions, current task, questions, connection; model/provider changes, stop, resume.
- [x] Delivery: Sending / Delivered / Agent responding, exact-key safe retry, retained recoverable draft.
- [x] Tasks and read-only sub-agent navigation, live progress.
- [x] Artifacts: inline audio/video, image zoom, text/code/document preview, download/share.
- [x] Questions: persistent answer tray, session badges, expired requests non-actionable.
- [x] Preferences: accents, AMOLED, text size, spacing, haptics, activity detail; preserve reading position.
- [x] Web regression suite, native unit/lint/release build, screenshot review, documented device limits.

Design: existing system typography and semantic teal/blue/violet/amber accents. Variance 3, motion 2, density 4; 48px/dp controls. Command center leads with state and next action. Settings use labeled controls with immediate preview. Existing scroll-follow ownership remains authoritative. Local React guidance search had no verified match; existing project patterns and mobile skill defaults govern state persistence.

## Verification

- Backend: 163 tests passed; TypeScript, ESLint and production build passed. Additional provider-ownership assertions passed all six provider restart tests.
- Browser: 55 distinct scenarios passed across the full suite and targeted reruns. Covered delivery recovery, questions/expiry, tasks/sub-agents, native model/provider controls, media playback/download, file preview/share, preferences, reading position and mobile navigation. One initial test hit a temporary 404 while the Android packaging build regenerated shared web assets; its isolated rerun passed. Another expected the old image-specific download label; it was updated to the unified file-viewer label and passed, including zoom and virtualized-row removal.
- Android: unit tests, lint, debug APK and instrumentation APK compilation passed; signed 0.1.21 release built. Instrumentation was not executed on a device in this run. Physical-phone keyboard, share sheet, haptics and font-scale checks remain device-validation limits, not claims inferred from browser tests.
- Reviewed phone screenshots for settings, command center and pending-question tray. Dialogs centered after visual review. Safe text preview keeps HTML inert and preserves downloaded/shared bytes.
- Existing native clipboard, dictation, Back and scroll-follow implementations remain in place. These additions do not introduce automatic chat submissions, automatic retries or a second harness owner.

Artifact document previews cover text/code formats; Office/PDF files remain downloadable and shareable. Provider/permission/mode actions continue to depend on the harness's actual capabilities.

## Delivery

Web/gateway release `0178b1d` deployed and healthy. Live authenticated phone-sized browser opened the command center without page errors or horizontal overflow. Android 0.1.21 published through the signed build script; authenticated APK download was 4,899,521 bytes and matched SHA-256 `12b5f207af13691b4e39b9bfc52968c124cd79ea78cabe535aefeecec339a7a6`. Five final browser checks passed after dialog centering.

The intervening Flapi-health restart error was fixed separately in CFRproxy `0cec02c`: normalize the Artifact tool's standalone NUL regex escape without dropping tools or changing its schema meaning. The deployed proxy accepts all 192 original tools through ccBudget/DeepSeek in both buffered and streamed requests. The original pattern already succeeded on Codex. The affected native conversation was preserved and its project instruction was not resent.

### 0.1.22 native validation and delivery recovery

A confirmed gateway receipt now moves an uncertain Android message to accepted and unlocks the composer. Its bubble remains until native history acknowledges it. Recovery preserves newer drafts and transcription text and never resends the request automatically, matching web receipt recovery.

All 23 instrumentation tests passed on a disposable Android 15 x86_64 emulator, including native clipboard/IME image input, Back, keyboard insets, question responses, delivery recovery, dictation drafts, model controls and settings persistence. A strengthened late-receipt/new-identical-draft test also passed separately. Added coverage for AMOLED/reading/activity/spacing/haptic preference persistence and pending-question visibility/expiry with responses-only filtering. Native keyboard-open/closed screenshots were reviewed. Unit tests, lint and debug/test builds passed. Physical-phone share targets, vibration and OEM keyboard/font behavior remain separate checks.
