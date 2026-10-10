# Chat-first mobile audit — 8 October 2026

Target: familiar Claude Android coding-chat behavior over existing Herdr-owned agents, with original Relay branding. Android-first PWA, also iOS and desktop. Design variance 3, motion 2; inbox density increased to 6 while conversation stays at 4. System fonts and existing accessible teal/neutral tokens retained.

## Findings and decisions

| Priority | Finding | Decision / implementation |
|---|---|---|
| Critical | A working but unbound Codex process shows “Ready for your next instruction” with no composer. Process discovery is being mistaken for chat readiness. | Empty states now distinguish missing chat connection, working, and genuinely empty conversations. Automatic native identity repair remains necessary; a wording fix does not restore control. Never guess identity from CWD/title. |
| Critical | No photo, camera, or file picker; protocol rejects all attachments. | Implemented upload storage, authenticated binary routes, immutable session-bound references, queued delivery, thumbnails, progress, removal, retry, paste/drop, and draft restoration. Same-host Claude/Codex delivery uses actual file paths for native file/image readers. Other hosts must explicitly enable shared local-file access. |
| High | Tools and tool outputs dominate the conversation as separate full-width cards. | Consecutive native tool events now collapse into one activity group. Every original event remains inspectable. Chat messages carry the main visual hierarchy. |
| High | Tall navigation chrome and oversized session rows hide actual sessions. | Reduced brand/header/row padding, removed duplicate settings and redundant location row, expanded titles to two lines, retained agent/host/full CWD, strengthened selection. |
| High | Draft disappears on page reload. | Text and completed attachment references persist in tab session storage. Failed uploads remain recoverable while the page is open. Attachment bytes remain in protected gateway storage. |
| Medium | Session total ignores filters; “Connected” overstates individual agent readiness. | Count now reflects matches; gateway WebSocket state says “Live updates.” Agent and conversation readiness remain separate. |
| Medium | Copying agent answers and taking conversation content elsewhere is cumbersome. | Message copy and timestamps; desktop export explicitly covers loaded conversation history. Full-history export remains follow-up work. |
| High | Phone keyboard can leave the composer below the visible browser viewport. | Dynamic visual-viewport height, content-resizing viewport hint, safe-area padding and constrained textarea. Browser-sized keyboard simulation required; physical device validation remains outstanding. |

Private real-session screenshots are stored outside Git at `~/.gstack/projects/harnessrc/designs/design-audit-20261008/`. Only mock conversation screenshots belong in docs/screenshots.

## Interaction contract

The main phone screen is a conversation: compact back/title/agent/CWD header, readable messages, collapsed activity, exact question/approval cards, and a bottom composer. Attach opens Photos / Camera / Files. Files show filename, thumbnail where safe, progress, error/retry, and Remove. Default Send/Steer uses live native turn state and immediate delivery receipts; only an explicit Queue action schedules work. Steer appears only for native support and cannot silently discard attachments. The queue is reachable from the header; approval responses target their native request and never become generic chat turns.

48 CSS-pixel touch targets; 16px input text; both themes; visible focus; no gesture-only critical actions; browser back and deep links; reduced motion. PWA file/camera pickers deliberately use browser/platform pickers, not React Native dependencies. Camera availability and capture behavior depend on browser and OS.

## Verification and remaining work

Backend coverage includes attachment authorization, session replacement, path traversal, size limits, integrity, durable references, deletion protection, idempotency and actual dispatch contents. Browser coverage includes uploads, photo/file selection, reload recovery, removal, send, accessibility, approval/queue/reconnect, 320–1440px layouts and 200% text. Physical Android/iOS camera, keyboard and background-resume testing is still required.

The full product is not complete: existing CLI rich-question routing, automatic recovery of missing native IDs, Hermes/OpenCode/OMP control, closed-app push, full-history exports and complete file/diff/subagent views remain acceptance gaps. These must be implemented and tested rather than hidden behind a cosmetic “supported” label.

## Conversational updates and native models

- Persistent three-dot activity indicator uses the harness's actual working state, with native tool/writing activity. It disappears when idle or disconnected and respects reduced motion.
- Conversation events append over authenticated WebSocket messages. Reconnection replays history; ordinary activity does not repeatedly fetch the transcript.
- Consecutive tool events and native reasoning summaries share one expandable activity group, keeping messages prominent.
- Live deltas preserve composer focus/drafts and the scroll position of a user reading earlier messages. The Latest messages action returns to the live conversation.
- Harness-reported models appear in the inbox, chat header, and details. Unknown model metadata is labeled explicitly.
- Five browser cases pass, including simulated mobile streaming, scroll/focus preservation, model labels, reduced motion, attachments, approval handling, and responsive layouts.
- Real Fred verification: the previously unbound shared-daemon Codex thread opens with conversation, model, composer and attachment controls. A separate ordinary Codex CLI under Herdr completed two browser-submitted queued tasks serially with one dispatch each.

## OpenUI and interaction reliability pass

OpenUI Button/IconButton/TextArea primitives now share Relay’s theme. The dark palette is neutral, header text is compact with full session identity available in details, and the composer grows from one row. Exact native question-reply envelopes render their question and answer without leaking internal request IDs. The edge overlay was removed; gestures ignore interactive targets and preserve vertical scrolling/pinch zoom. Repeated real browser touch taps with finger jitter cover menu, close, copy, and attachment controls. Clipboard failures are visible; HTTP deadlines preserve uncertain outgoing messages rather than locking the composer indefinitely.

## Chat composition revision

The previous OpenUI release preserved too much of the old structure. The new composition replaces the four-line permanent header with a title/model disclosure and a compact status/directory strip, combines model/host information in shorter drawer rows, reduces the composer to text plus a reachable action row, and removes its permanent explanatory footer. A distinct neutral user-message surface and circular blue send control separate messages from actions. Both themes were reviewed with realistic chat content. A duplicate textarea focus outline discovered in the dark screenshot was removed in favor of one visible composer focus boundary. Native DSH support remains incomplete; see DSH.md for the implemented transport and actual deployment blockers.

## Mobile Back navigation

Mobile conversations now have a session-drawer parent in browser history, including initial deep links and reloads. Android/browser Back from chat opens that drawer; Back from a secondary screen returns to chat; Back closes a manually opened drawer. The drawer close button returns to chat without discarding the draft. Desktop history remains unchanged. The browser test exercises real history traversal, reload, secondary navigation and retained draft text; physical Android system-button behavior remains a device check.

## October 9: session collections, delivery receipts, keyboard and installation

The DSH host listed 118 persisted sessions, only two with loaded agents. Relay previously labeled all of them idle. Native `agentAvailable` now supplies live/saved presence, and the drawer defaults to Live with a separate History collection. One-tap harness choices show counts; secondary filters cover status, host and directory. Search combines words across title, agent, model, host and CWD. Saved sessions have an explicit label and no misleading unread dot. Filter preferences survive reload; Clear removes combined filters.

The reported double message had one native user event and one confirmed delivery receipt. Its optimistic card used the browser request ID while idle Send returned a different task ID. The UI now correlates both IDs, matches attachment identities for old cards, and checks an authenticated receipt endpoint when the real event is older than the loaded history page. None of these display checks sends or retries a message.

The viewport follows both visual height and offset on resize and scroll. The app is anchored to that visible region, including Android keyboard panning without a layout-window resize. The Latest messages control tracks measured composer height. Browser tests simulate visual-only resize/pan; physical Android confirmation is still required. See [Chrome's viewport behavior](https://developer.chrome.com/blog/viewport-resize-behavior).

Settings includes Install app, captures the browser's native install event before rendering, prevents repeat prompts, handles dismissal/error/installed states and provides manual browser instructions when native prompting is unavailable. See [the install event API](https://developer.mozilla.org/en-US/docs/Web/API/Window/beforeinstallprompt_event). Browser tests inject the event and verify the prompt is invoked once; they do not claim to exercise an OS installer.

## Native command records — October 9

The supplied Claude screenshots exposed command envelopes and background task records as large user bubbles. The existing calm mobile chat direction (variance 3, motion 2, density 4) is retained. Exact command envelopes now show the slash command and original instruction; local output and task notifications use compact activity disclosures with two-line previews and 48px minimum targets. Full output, task IDs and file paths remain available on expansion. Semantic light/dark colors and existing system typography are reused; no new motion or dependencies.

Presentation applies to existing history without altering stored events, native delivery, or message ordering. Only complete recognized envelopes are transformed; malformed envelopes, code fences and surrounding user prose remain verbatim. This is a React PWA change, not a native Android/iOS component. Local React guidance supported stable event keys, and Tailwind guidance supported constrained previews; the UX search produced no relevant disclosure match, so the repository's mobile hierarchy guidance was used.

Validation: parser regression cases cover command arguments, output/error records, task metadata, malformed/partial messages, and ordinary code. Browser coverage exercises expansion/collapse and horizontal reflow from 320px to 1440px, with light/dark phone screenshots. Physical Android/iOS rendering remains unverified.

## Artifact delivery and launch navigation — October 9

Generated files now have an explicit artifact card with a large image preview, modal viewing, and a visible download action. The existing neutral/teal theme, system typography and 48px controls are retained. Publication uses the authenticated binary API and durable events; it does not turn generated text into executable UI. Browser regression coverage verifies live arrival, duplicate publication, preview, byte-for-byte downloads, and reload recovery.

Cold mobile launch now establishes the drawer parent before transport/authentication work, including when an installed browser restores a `relayChat` marker without the original back stack. First Back opens sessions; Back from the base can still leave the app. Browser tests cover the restored-marker case, reload, drafts, and secondary navigation. Physical Android system Back remains a separate device check.

Attention-state follow-up: a verified native steering capability remains selectable while Herdr reports `blocked`. The gateway's immediate-message route still obtains authoritative native turn state and rejects submissions with pending broker interactions. Browser coverage checks the composer remains enabled rather than incorrectly reporting that steering is unsupported.
