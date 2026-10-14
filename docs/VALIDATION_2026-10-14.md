# Provider restart and download validation, 2026-10-14

Gateway/web deployed from `fbdfd3a`. Signed Android 0.1.18 / versionCode 19 was published using the existing private signing key. Its served download is 4,860,513 bytes, SHA-256 `e158bc070ff3c3ec2bd32fb748822fedb6995fbc19127b567e7b33a17352b761`; APK signature verification and the authenticated HTTPS download checksum pass.

## Automated checks

- `npm run check`: 155 backend/shared tests, TypeScript, ESLint and production web build passed. The final additional native-permission read-back guard passed TypeScript, ESLint and all five provider-swap regressions again.
- Full Playwright suite: 50 passed, including long-press provider/model/permission selection and original request identity. The new test isolates its idle fixture from earlier shared-mock turn mutations.
- Android: 19 JVM tests, lint, debug instrumentation APK compilation and signed release build passed. Instrumentation was compiled, not run on a device.

## Live checks

A disposable native Codex thread and Herdr CLI pane were created with no user prompts. Using the deployed gateway's authenticated tailnet API, the session was observed idle with a verified native binding, restarted through the CFRproxy launch profile, and returned `started` with the same native conversation ID/CWD and a new terminal. The gateway's native model/provider and sandbox/approval read-back checks passed before success. The resulting test pane was then closed through Herdr. Existing project sessions were not restarted.

Four published Hermes trouble attachments returned HTTP 200 and complete bytes through the same tailnet HTTPS ingress:

| File | Download bytes |
| --- | ---: |
| AGENTS.md | 8,471 |
| SOUL.md | 3,166 |
| audit.txt | 7,482 |
| canna-agent-files.zip | 10,663 |

The source files were non-empty. The old Android implementation opened a destination first and stored pending download/launcher/coroutine state in individual scrolling message rows. Row disposal could lose the pending source or cancel the subsequent fetch/copy, leaving the destination empty. The new app-root picker and ViewModel transfer validate private-cache bytes before creating the destination. JVM tests cover complete binary copying and empty/truncated rejection; backend tests confirm published historical downloads survive owner changes while draft reuse and cross-conversation access remain forbidden.

## Outstanding verification

Physical Android document-picker/recreation behavior and provider restart still need a phone check after installing 0.1.18. Live Claude provider restart was not tested. Exact resume remains unsupported for other harnesses. Uncertain restart and hard-crash native-archive recovery remain manual as documented in [provider swap](PROVIDER_SWAP.md).
