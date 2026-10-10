# Validation evidence and Fred acceptance

Local inspection found Herdr 0.8.0, protocol 19 and Codex CLI 0.161.0. The installed Herdr schema is checked into test fixtures; mock response contracts are validated with AJV. Installed Codex generates ClientRequest/ServerRequest schemas and the bridge detects supported methods. Subsequent Fred checks read real structured transcripts and sent harmless instructions only to dedicated validation sessions. Codex has since updated to 0.162.0; its shared-daemon topology was inspected separately.

Latest local result: **62/62 unit/integration tests and 11/11 browser tests passed**, with TypeScript, lint and production build passing. OpenUI dependency and license review is recorded in OPENUI.md.

Run `npm run check` for TypeScript, lint, unit/integration contracts and production assets. Run `npm run test:e2e` after installing Playwright Chromium (or set `CHROMIUM_PATH` to an installed Chrome executable). Tests cover partial UTF-8 transcripts, rotation and symlink escapes; native dedup/redaction; queue CRUD/idempotency/order/recovery/uncertain delivery; exact pending questions/approvals/double submission/expiry/replacement; device authorization/rotation/revocation and WebSocket origin; a genuine Claude hook executable's documented output; and a real Codex bridge process against a credential-free JSON-RPC fixture.

Browser tests pair privately, request native approval, queue two follow-ups, answer the exact card, verify ordered completion, disconnect/reconnect, and inspect settings. They check phone widths 320/375/390/430, landscape, tablet and desktop, 48px targets, no horizontal overflow, text scaling, reduced motion, and axe WCAG 2.1 AA checks in light/dark themes. Screenshots live in `docs/screenshots`. These are browser emulation tests, not physical device or live harness acceptance.

## Executable checks on Fred

```sh
herdr --version
herdr api schema --json
RC_CONFIG=~/.config/relay/config.json npm run diagnose -- --live
curl --fail http://127.0.0.1:4080/health
npm run check
npm run test:e2e
```

Diagnostics print version, available required methods, private socket ownership and counts only. Treat the installed schema as authoritative if Fred differs. No undocumented API is required.

## Remaining live acceptance

1. Start an ordinary Claude/Codex CLI in Herdr. Pair the phone, verify automatic discovery, correct native ID, ordered structured history, and simultaneous original terminal usability. Send a harmless instruction from the composer and verify it appears in the original native transcript. Queue two follow-ups and verify native completion releases them in order.
2. Install the Claude hook and trigger a real supported tool permission. Verify the exact pending card, allow/deny, original process continuation and terminal fallback when the gateway is unavailable. Generic Claude questions are outside this adapter's supported scope.
3. Launch/register the Codex bridge under Herdr. Submit a real native turn, inspect streaming, trigger requestUserInput or a tool approval, answer its specific card, and verify it continues without a second user turn. Queue two followups while busy and verify serial execution.
4. Disconnect the phone, reconnect, restart only the gateway, and verify no duplicate messages, no repeated task sends, persistent queue and pending interaction state. Replace the native process and verify old controls/tasks cannot target its replacement.
5. Test Android Chrome and iOS Safari/PWA installation, software keyboard, safe areas, focus, text scaling and foreground notifications. Closed-app native push is not implemented.

CLI chat and queue transport is implemented; complete native question/approval parity remains limited as documented in CAPABILITIES.md. Mock-backed Phase 1 and the supported native bridge pathway are executable now; live interactive parity must not be inferred from fixture results.

## Fred validation, October 8, 2026

A normal Claude Code CLI was started in an additional Herdr tab, not a native gateway bridge. Discovery found its existing native identity and title “Relay CLI validation.” The staged gateway submitted three harmless messages through `agent.prompt`. All three reached that same process and completed serially according to its native JSONL `end_turn` events. Existing user panes were left running. This verifies actual existing-CLI chat and queue dispatch, not universal native question parity.

The CWD test covers a foreground MCP helper in a different directory: discovery selects the coding-agent process's directory instead. The tailnet authentication contract tests verify key-free private HTTP/WebSocket access, rejection of forged public headers and unknown peers, CSRF/origin enforcement, and device revocation.

## Mobile attachments and UI audit, October 8, 2026

A separate ordinary Claude CLI named “Relay file validation” was started under Herdr. The staged gateway uploaded a text file and a screenshot, sent both through the existing CLI via Herdr, and verified the native answers (`RELAY_ATTACHMENT_READ_OK` and the screenshot title `Atlas API`). Both final tests completed automatically from native transcript evidence, with uploaded attachment metadata attached to the chat event. No user agent was restarted. Two earlier fixture attempts were cancelled because the already-running validation CLI retained its old file-read permission matcher.

Live image testing exposed Claude's native inline-image expansion: it rewrites the submitted prompt and emits an image-source companion. Transport-generated request receipts now survive that transformation; native meta companions are not shown as separate user turns. Multiline pasted-content envelopes are matched exactly. Read/Glob/Grep have been added to the Claude permission-hook configuration. A live mobile permission decision on those newly added tools remains unverified.

The expanded suite passes 35 unit/integration tests and 4 browser tests. Mobile cases now include file/photo pickers, saved upload references, draft reload, remove/send, a 20-session inbox, missing native identity, and a keyboard-sized visual viewport. Screenshots include dense inbox, attachments, disconnected chat and unbound chat. Physical Android/iOS keyboard and camera checks remain outstanding.

The selected unbound Codex CLI is a thin client connected to an already-running shared Codex app-server daemon. The CLI foreground PID and executing daemon PID differ. Standalone ancestor-based identity hooks cannot establish that binding. Integrating the existing daemon's native session identity is a separate requirement; do not launch a second app-server to attach to it or guess a thread from its title/CWD. Installed 0.162.0 CLI help and generated protocol were inspected; no daemon write operation was performed.

Production release `46b12da` was then verified through a fresh mobile-sized browser on the authenticated Tailscale listener. The browser uploaded a screenshot, submitted it to the dedicated existing Claude CLI, observed native task completion, and rendered the sent-image thumbnail. The public page, gateway health and private authenticated API returned HTTP 200. Production screenshots remain private under the local audit directory. The staging gateways were stopped after validation; existing user agents were left running.

## Shared Codex daemon follow-up

The earlier missing-identity investigation now has an implemented route: metadata-only native name challenges, exact Herdr title echoes, durable name restoration, and fresh dispatch verification. A live probe on Fred's existing build thread proved the mapping and restored the original name without sending a turn. Contract tests reject same-name thread switches, duplicate echoes, missing echoes, and foreground-process replacement. Model tests cover native Claude/Codex model extraction and replay ordering. Deployment and browser verification are recorded below when completed.

Fred verification: release 572868b plus a narrowly scoped systemd `BindReadOnlyPaths` drop-in connected the existing build thread `01a11c4e-8889-74d1-afe7-e02cbe863d09`. The mobile browser followed its old unbound URL to the bound conversation and displayed `gpt-6-astra`, an instruction composer, and photo input. A separate ordinary Codex CLI, launched using Herdr `agent.start`, was discovered automatically; two browser-submitted tasks completed in order, each with one attempt. These checks used the private Tailscale HTTPS endpoint. Fresh automated Chromium access to the public hostname did not complete automatic tailnet authentication; the existing user's browser was already authenticated, but that fresh-browser public-origin path remains unverified.

Incremental WebSocket event tests enforce per-session grants and immediate revocation. The fifth browser case verifies stream updates without transcript refetches, draft/focus retention, stable older-history reading, native-model display, and reduced-motion working indicators. Native questions/approvals for existing Codex CLI clients remain unsupported; the gateway-owned bridge supports its own native requests.

## OpenUI and touch reliability follow-up

The browser suite now exercises real Chromium touch events, repeated menu taps with finger movement, edge swiping, copying a message, opening the attachment picker, and native question-reply presentation. Light and dark mobile screenshots are committed. Invisible swipe hit areas were removed; gestures ignore interactive controls. Default messages use native-state Send/Steer routing; only explicit Queue creates pending work. Known Codex owner revalidation proves its mapped thread directly instead of scanning every loaded thread. The 60-test backend suite covers that proof, durable message receipts, and presentation parsing. Physical Android/iOS gesture and keyboard verification remains outstanding.

Release `be6e77c` was deployed on Fred; gateway health passed and the public page served `index-ChgjcUdK.js`. A dedicated existing Codex CLI accepted a default message with `mode: send`, then accepted an update during that turn with `mode: steer` in 3,719 ms. Its native assistant reply changed to the requested `RELAY_DIRECT_STEER_OK` at 23:16:17 UTC. No pending task was substituted for that steering request. The measured native acknowledgement is still several seconds; immediate local feedback does not make that latency disappear.

## Native DSH and composer repair, October 8

The DSH web host's conflicting services and unloaded/restricted model catalog were repaired. A real isolated native session selected CFRproxy's `codex/gpt-6.1-sol`, completed a prompt with `DSH_MODEL_SELECTION_OK`, and accepted provider/model changes through the native session API. Relay's DSH fixtures exercise discovery, history pagination, reconnect deduplication, stream positions after reasoning chunks, model selection, steering and session removal.

The mobile suite now has 12 passing cases, including repeated CDP touch taps on Attach while working, native file chooser events for both files and photos, active-turn upload delivery without a task-queue request, and send-icon geometric centering at a 390×520 keyboard-sized viewport. Screenshots: `attach-keyboard-mobile.png`, `steer-attachments-mobile.png`. This is browser touch emulation; the physical Android keyboard, camera and picker still need device confirmation.

Live follow-up: a real existing Codex CLI under Herdr accepted an image through the actual native `turn/steer` pathway while its turn was confirmed active. Its final answer read `MOBILE 7392` from image pixels; that text was not in the prompt. The reply stayed in the active turn, with no queued task. A separate file-reference test exposed that the isolated session has no file-reading tools; regular document references require those tools. DSH discovery reported 118 connected native sessions, loaded the existing structured history and completed a Relay-sent prompt with `RELAY_DSH_SEND_OK`.

## Session filters and stuck outgoing cards

Regression coverage verifies live versus saved DSH filtering, native blocked-state filtering, model/CWD search, combined filters, Clear and reload persistence. A stored optimistic attachment message with a different browser/native ID now disappears when the actual message arrives, including after reload; receipt recovery handles events outside the loaded page. Gateway receipt reads require authentication and session access.

Keyboard regression tests keep the layout viewport fixed at 390×844 while independently changing visual viewport height and vertical offset. They assert that the composer and send target remain above the simulated keyboard and that the draft survives opening/closing. Installation tests cover manual guidance, deferred native prompting and appinstalled state. These are browser simulations; physical Android/iOS keyboards and installation remain separate device checks.

Final local verification for this revision: TypeScript, ESLint and production build passed; 67 backend tests and 16 browser tests passed. Screenshots inspected: session-filters-mobile.png, visual-viewport-keyboard.png, install-app-mobile.png. Native receipt IDs override client clock skew; saved attachment cards also recover through a permission-checked durable receipt lookup when their native event is outside the current page.

### Codex attention title recovery

Codex's `[ ! ] Action Required | ` prefix is a status decoration, not a new native thread. Relay removes only that exact prefix when selecting and verifying title candidates. The native random nonce echo, foreground process identity, and per-delivery proof are unchanged. Regression coverage verifies discovery during attention, normal/attention transitions, and rejection when a terminal switches to another identically named thread.
