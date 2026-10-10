# Required UI design workflow

Before designing, implementing, or reviewing the web UI, read `../../docs/UI_DESIGN.md` and the complete repository skills:

1. `../../.agents/skills/mobile-design/SKILL.md` — primary mobile interaction guidance; read its design-process reference and relevant navigation, form, accessibility/touch, and review references.
2. `../../.agents/skills/ui-ux-pro-max/SKILL.md` — run applicable local searches using React and HTML/Tailwind stacks; inspect fit before applying output.
3. `../../.agents/skills/frontend-design/SKILL.md` — intentional visual design and screenshot critique.

Apply the PWA-specific requirements in UI_DESIGN.md. User instructions and truthful capability restrictions take precedence over third-party defaults. Do not switch to React Native/Expo or add a marketing hero to the app. Make routine decisions from the existing brief. Before delivery, inspect mobile screenshots and validate the real chat, question/approval, and task-queue flows. Record what was tested and what remains unverified.

## Cross-client parity

Treat web and Android as first-class clients. For every user-facing change, inspect the corresponding native behavior and follow `../../docs/CLIENT_PARITY.md`. Record platform differences explicitly; a web deployment does not update installed APK code.
