# Relay UI design system

Read docs/UI_DESIGN.md and its pinned mobile-design, ui-ux-pro-max, and frontend-design skills before changing the interface.

Relay is a private coding-agent messenger: calm, readable, and explicit about pending input. Its distinctive element is the conversation and attention workflow, with one restrained evergreen accent. Compact session rows use separators; only messages, interactions, and focused tasks need containers. There is no marketing hero or decorative motion.

Variance 3/10; motion 2/10; density 4/10. System sans-serif preserves browser/native familiarity. System monospace is reserved for code and commands. Body and inputs use 16px, secondary UI 14px, section titles 20px, and app titles 28px. Message measure is at most 70 characters. Spacing follows 4/8px; radii distinguish small controls (8px), cards (12px), and messages (18px).

| Semantic role | Light | Dark |
| --- | --- | --- |
| Background | #f5f7f8 | #111b1d |
| Surface | #ffffff | #182629 |
| Primary text | #15272c | #e6eff0 |
| Secondary text | #53676e | #a0b2b8 |
| Accent | #246b60 | #85ccbe |
| Text on accent | #ffffff | #10201c |
| Border | #d9e2e5 | #34484e |
| Warning text | #815616 | #efd093 |
| Danger text | #a93436 | #ffa2a4 |

Use semantic CSS variables, with light/dark mappings. Meaningful status and controls also have text labels. Default mobile hit regions are 48×48 CSS px. Motion is limited to 160ms state feedback and disabled under prefers-reduced-motion.

Phone navigation uses a session list and full conversation with browser history, a bottom composer, and exact-request interaction cards. Larger windows use a 320px list/detail split. Queue, details, attention, hosts, devices, and notifications are dedicated views. Dialogs preserve focus using native HTML dialog. Keep unsupported actions absent and capability restrictions legible.

Use safe-area inset padding, 100dvh with a 100vh fallback, scroll restoration, a jump-to-latest action, paginated/virtualized history, and content insets that keep controls clear of the composer. Approval cards show the exact action and never default to allow. Drafts remain in memory across screen changes and failed requests; auth credentials stay in HttpOnly cookies.

Verification evidence belongs in docs/VALIDATION.md; do not confuse browser-emulated devices with physical-device testing.
