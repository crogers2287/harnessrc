# OpenUI integration

Relay uses the MIT-licensed `@openuidev/react-ui` 0.17.0 standalone Button, IconButton, and TextArea components, with its component styles and Relay's semantic colors and 48px touch targets. Package versions are pinned in package-lock.json; the license is retained in licenses/OPENUI-MIT.txt. Source: https://github.com/thesysdev/openui.

The full AgentInterface composer owns OpenUI thread state and disables ordinary submissions while its model is running. Relay instead keeps its Herdr/native adapter routing, durable message receipts, explicit Queue, and exact native interaction broker. No additional LLM connection, telemetry, or generated approval policy is introduced. Standalone imports keep unused charts, math renderers, generative-UI runtimes, and bundled chat state out of the application bundle.

OpenUI 0.17.0's standalone declaration barrels use extensionless relative imports that do not resolve under this monorepo's NodeNext setting. packages/ui/src/openui.d.ts re-exports the same component types from OpenUI's bundled declaration entry, while runtime imports remain standalone.

Dependency review: npm audit reported five low-severity findings in the dependency chain for the unused KaTeX/math renderers at integration time. Those renderers are not imported by Relay. Do not describe the entire dependency tree as audit-clean. A future upgrade should recheck these advisories and the standalone declaration fix.

The visual changes are paired with behavioral fixes: no invisible swipe overlay over buttons, gestures exclude interactive controls, native question envelopes render as question/answer context, clipboard errors are visible, HTTP requests have deadlines, and loss of live-update WebSockets does not by itself disable authenticated HTTP sends.
