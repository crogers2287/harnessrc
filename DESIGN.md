# Relay UI design system

Read docs/UI_DESIGN.md and its pinned mobile-design, ui-ux-pro-max, and frontend-design skills before changing the interface.

Relay is a private coding-agent messenger: calm, readable, and explicit about pending input. Its distinctive element is the conversation and attention workflow, with one restrained evergreen accent. Compact session rows use separators; only messages, interactions, and focused tasks need containers. There is no marketing hero or decorative motion.

Variance 3/10; motion 2/10; density 4/10. System sans-serif preserves browser/native familiarity. System monospace is reserved for code and commands. Body and inputs use 16px, secondary UI 14px, section titles 20px, and app titles 28px. Message measure is at most 70 characters. Spacing follows 4/8px; radii distinguish small controls (8px), cards (12px), and messages (18px).

| Semantic role | Light | Dark |
| --- | --- | --- |
| Background | #f5f7f8 | #16191c |
| Surface | #ffffff | #1c2024 |
| Primary text | #15272c | #ecf0f2 |
| Secondary text | #53676e | #aab5bd |
| Accent | #246b60 | #85ccbe |
| Text on accent | #ffffff | #10201c |
| Border | #d9e2e5 | #363e44 |
| Warning text | #815616 | #efd093 |
| Danger text | #a93436 | #ffa2a4 |

Use semantic CSS variables, with light/dark mappings. Meaningful status and controls also have text labels. Default mobile hit regions are 48×48 CSS px. Motion is limited to 160ms state feedback and disabled under prefers-reduced-motion.

Phone navigation uses a session list and full conversation with browser history, a bottom composer, and exact-request interaction cards. Larger windows use a 320px list/detail split. Queue, details, attention, hosts, devices, and notifications are dedicated views. Dialogs preserve focus using native HTML dialog. Keep unsupported actions absent and capability restrictions legible.

Use safe-area inset padding, 100dvh with a 100vh fallback, scroll restoration, a jump-to-latest action, paginated/virtualized history, and content insets that keep controls clear of the composer. Approval cards show the exact action and never default to allow. Drafts remain in memory across screen changes and failed requests; auth credentials stay in HttpOnly cookies.

Verification evidence belongs in docs/VALIDATION.md; do not confuse browser-emulated devices with physical-device testing.

## Chat-first revision, 8 October 2026

Phone inbox uses a Sessions header and a compact pair of activity/agent filters. The Relay brand remains in the desktop sidebar. Names may occupy two lines; CWD remains visible and timestamps share the status line. Tool activity is grouped; internal queue/dispatch/completion notices do not clutter chat. Queue contents have their own view and a composer preview while pending. Composer supports files, photos, camera capture, paste/drop, upload progress, retry/removal, reload-safe drafts and sent-image inspection. Visual viewport resizing keeps it reachable with the software keyboard; physical device verification remains outstanding. See docs/UI_AUDIT.md for evidence and remaining functional gaps.

The October 8 OpenUI pass uses a compact chat header, a one-row expanding composer, neutral dark surfaces with accent reserved for controls, and reply context instead of native transport envelopes. OpenUI standalone primitives share Relay’s state and ownership rules; see docs/OPENUI.md. Horizontal drawer gestures never intercept a button or form field, and no transparent hit layer covers the conversation.

## Chat composition revision

Reading this as a conversational coding-agent remote for one-handed phone use, with a restrained messaging interface on Android/iOS browsers and desktop. Dials: variance 3, motion 2, density 6. The title is a disclosure control; the model stays immediately underneath, with status and a truncated full-path directory strip below. Expanded metadata uses a labeled definition list. Session rows combine model/host and shorten previews; the transcript gets the reclaimed space. The composer uses a circular 48px submit button and retains an explicit Send/Steer versus Queue selector. Neutral user bubbles (`#eff0f3`, dark `#303236`) separate conversation from controls; the blue action colors (`#335dc0`, dark `#b7caff`) mark only submission. System typography, reduced motion, accessible names, and visible gesture alternatives remain.
