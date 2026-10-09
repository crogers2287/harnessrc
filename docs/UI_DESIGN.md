# Mobile UI design requirements

The React PWA now implements this workflow. See root DESIGN.md and docs/screenshots for the resulting tokens and interface. Playwright checks responsive layout, touch targets, reconnects and accessibility; physical iOS/Android testing remains outstanding.

## Selected skills and scope

Use the repository copies, with sources pinned in [design-skills.lock.json](design-skills.lock.json). The complete licenses are included in each skill directory. They are also installed in the current developer's Codex skill directory and available on the next turn.

| Skill | Role in this project | Source and license |
| --- | --- | --- |
| [Mobile Design](../.agents/skills/mobile-design/SKILL.md) | Primary mobile UX guidance: touch, keyboard, safe areas, navigation, adaptivity, accessibility, and states | [RubenGlez/mobile-design](https://github.com/RubenGlez/mobile-design), MIT |
| [UI/UX Pro Max](../.agents/skills/ui-ux-pro-max/SKILL.md) | Local searchable design guidance and React/Tailwind implementation checks | [nextlevelbuilder/ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill), MIT |
| [Frontend Design](../.agents/skills/frontend-design/SKILL.md) | Deliberate visual identity, typography, composition, copy, and screenshot critique | [anthropics/skills](https://github.com/anthropics/skills/tree/main/skills/frontend-design), Apache-2.0 |

These are the best fit among the inspected candidates for this brief, not a claim of a measured universal ranking. Mobile Design is a small project with unusually relevant platform and state guidance. UI/UX Pro Max provides broad searchable coverage; recommendations require review. Anthropic's skill contributes visual craft, while the mobile skill governs app ergonomics. A reviewed alternative, ceorkm/mobile-app-ui-design, had no declared repository license and several decorative defaults unsuitable for a control interface, so it was not installed. Vercel's web guidelines remain a useful reference, but do not add another overlapping installed skill here.

## Priority and implementation target

The user request, BUILD_ASSIGNMENT.md, security requirements, and this document take precedence over third-party defaults. Keep React, TypeScript, Tailwind, and the PWA architecture. Adapt native mobile design guidance to browser primitives; do not introduce React Native, Expo, native-only modules, remote fonts, or dependencies merely because a skill mentions them. The current product, audience, stack, and security context are already supplied: routine design decisions do not require another user question.

Read the mobile skill first, UI/UX Pro Max second, and Frontend Design third. Use Mobile Design for ergonomics, UI/UX Pro Max for applicable implementation guidance, and Frontend Design for intentional visual choices. In a conflict, preserve safe, understandable remote-agent control and the documented capabilities.

## Product direction

Reading this as: a chat-first coding-agent remote for developers checking persistent sessions one-handed, with a calm, precise interface, targeting Android, iOS, and desktop through an installable PWA.

Design dials: variance 3/10, motion 2/10, density 4/10. Efficient session rows and readable conversations should carry the design. Use an original restrained accent, system typography for native familiarity, 4/8px spacing, and semantic light/dark tokens. Code blocks can use system monospace. Final token values must be recorded in a root DESIGN.md and contrast-checked before shipping.

The UI/UX Pro Max design-system search was executed with `developer chat productivity mobile`, then retried with `messaging productivity tool`. Both returned a marketing-oriented Product Demo + Features pattern. That pattern is not a verified fit for this app and was not persisted as its design system. Use the product-specific mobile direction above as the fallback; apply only individually relevant search results. The React stack search yielded stable message keys; the HTML/Tailwind search yielded mobile targets and focus-visible guidance. Its database references newer Tailwind versions than the project, so verify examples against installed versions before using them.

## Interaction contracts

1. **Inbox and navigation:** show project, harness, host, activity, waiting state, and queued count in scan-friendly rows. Use compact single-screen navigation on phones and a list/detail split on larger windows. Preserve browser back, deep links, drafts, and scroll position. Prefer separators over wrapping every item in a card.
2. **Conversation and composer:** readable content with expandable tools and diffs; a reachable bottom composer that remains usable with the software keyboard. Use `env(safe-area-inset-*)`, dynamic viewport sizing with browser fallbacks, and safe scroll insets. Do not pull a reader away from older messages; expose a jump-to-latest control when appropriate.
3. **Queue, Respond, and Steer:** distinguish these actions in plain text and show only adapter-supported controls. Confirm durable acceptance before clearing the draft. On uncertainty, retain the content and show recovery without blindly resending. A response card must name and resolve its exact native interaction.
4. **Approvals:** show the proposed action and relevant command, diff, or plan. Offer distinct Allow once and Deny controls. No preselected approval, ambiguous icon action, swipe-only approval, or approval inferred from prose. Expired and replaced interactions visibly disable controls and explain the recovery path.
5. **Complete states:** design loading, empty, working, waiting, disconnected, reconnecting, failed, expired, read-only, submitting, and confirmed states. Keep host connection health separate from agent status. Announce meaningful changes without reading every streamed token aloud.

## Verification required before UI delivery

- Review both themes at 375px and 430px phone widths, phone landscape, 768px tablet width, and 1440px desktop width. Include 320px reflow, 200% text/zoom, reduced motion, and long real transcript content. Browser emulation does not prove physical iOS/Android behavior.
- Use 48×48 CSS px as this PWA's default touch hit area, with separation. This is a browser design choice inspired by native guidance; CSS px, iOS pt, and Android dp are different units.
- Measure text contrast at 4.5:1 for normal text and 3:1 for large text; meaningful non-text controls need 3:1. Test focus visibility, semantic labels and roles, disabled states, keyboard order, and screen-reader announcements. State is never communicated only through color.
- Confirm safe areas, keyboard-visible submission, browser back, focus restoration, modal focus containment, deep links, draft preservation, pagination, scroll restoration, and virtualization. Approval cards and variable-height Markdown must remain usable within long history.
- Save and inspect screenshots of inbox, streamed conversation, approval/question, queue, disconnected state, and settings. Run browser E2E assertions for the actual task flows. Report physical-device checks separately until performed.

## Local tools

Verify vendored file integrity:

```sh
python3 scripts/verify-design-skills.py
```

Query the reviewed local guidance without transmitting repository or transcript data:

```sh
python3 .agents/skills/ui-ux-pro-max/scripts/search.py 'keyboard safe area mobile' --stack html-tailwind
python3 .agents/skills/ui-ux-pro-max/scripts/search.py 'destructive confirmation' --domain ux
```

Skill updates are deliberate: inspect the new revision and license, update the repository copies and lock file together, then rerun verification. Never silently track a mutable upstream branch during a build.

## October 8 conversation navigation and creation revision

The primary phone screen is now the most recent conversation (or the last selected one). Sessions live in a compact left-edge swipe drawer, with a visible menu alternative, focus containment, Escape/back dismissal, preserved drafts, and reduced-motion support. Queue is an explicit secondary choice; the default sends when idle and uses native steering only when the adapter advertises it. Busy sessions without steering explain why Send is unavailable.

New session is a focused, scrollable mobile form: permitted host directory, agent, provider, model (including a custom provider model ID), first message, and optional name. It keeps its request identity and draft across reloads. Native start acknowledgement, conversation discovery, and uncertain delivery have separate states. The first message also ensures a native conversation exists; creating an empty terminal is not the product flow.

The existing design dials and semantic colors remain. Mobile controls use 48px minimum hit areas; form controls use 16px text. Local React/Tailwind skill searches informed async errors, visible focus, and touch targets. Browser tests cover a 390px creation flow, accessible field names, saved receipts, edge swipes, focus restoration, and default Send. The existing suite covers phone widths 320–430px, landscape, tablet, desktop, large text, reduced motion, attachments, approvals, queue, and streamed chat. Physical iOS/Android testing remains separate.

### Steering delivery feedback and physical touch simulation

Steer inserts a local outgoing message immediately, clears and refocuses the composer, and leaves the next draft intact when the request finishes. “Sending” and confirmed native delivery are distinct; lost confirmation retains the message with an explicit uncertainty notice. Local cards survive tab reload and reconcile against native history for display only. They never trigger automatic resend. SQLite steering receipts prevent replay of the same request ID, including an interrupted delivery. File attachments cannot silently disappear into a text-only steering request.

The edge gesture test now uses Chromium's touch input protocol rather than JavaScript-created touch events. A narrow `pan-y` edge target lets horizontal movement reach the drawer while preserving vertical scrolling. Browser touch simulation still does not establish behavior against physical Android/iOS system back gestures; the menu button remains available.

The default composer now posts to the dedicated immediate-message endpoint. Native state chooses Send or Steer at delivery time; browser status affects the label only. Immediate sends get the same local outgoing card and composer preservation as steering. Only an explicit Queue selection schedules a future task. The end-to-end regression asserts the HTTP route and native delivery mode, not merely the button text.

### DSH launch discovery and clipboard screenshots

The new-session form now starts with an Agent selector spanning all configured launch profiles. Choosing DSH selects its native connection automatically, instead of hiding DSH behind the `fred-dsh` Host choice. Hosts are offered only when the selected agent has multiple destinations; folder access remains scoped to the selected launch profile. Model IDs and durable launch receipts are unchanged. The catalog refreshes while the form is open.

Attach includes an explicit **Paste screenshot** action using the browser Clipboard API after a user tap. It creates ordinary draft attachments with preview, progress, removal and existing Send/Steer behavior; it does not send automatically or read clipboard contents on focus. Standard file paste continues to work. The attachment chooser uses a compact two-column grid with 48px-plus targets, semantic colors, and inline denied/empty/unsupported clipboard recovery via Photos. Android keyboard apps may refuse to deliver images to a textarea, so the explicit action avoids depending on that keyboard path. Physical Android clipboard permission and keyboard behavior still require device confirmation.

Regression coverage includes selecting DSH from the initial Agent menu, choosing its folder/model and checking the launch request; actual Chromium clipboard write/read and Ctrl+V uploads; attachment delivery; and denied/empty clipboard fallback at 320px. No design-token or motion changes were needed (variance 3, motion 2, density 4).
