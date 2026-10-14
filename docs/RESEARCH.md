# API research, compatibility and reuse

Reviewed primary sources before implementation:

| Source | Findings / reuse |
|---|---|
| [Herdr](https://github.com/herdrdev/herdr), [socket API](https://herdr.dev/docs/socket-api/) | Apache-2.0. Used documented socket protocol; installed 0.8.0/protocol-19 schema fixture. No supervision code copied. |
| [Herdr Chat](https://github.com/eliasstravik/herdr-chat) | Reviewed discovery/transcript approach; no declared repository license at inspection, no code reused. |
| [Corral](https://github.com/neptunix/corral) | MIT; reviewed architecture, no code reused. |
| [Herdr Remote](https://github.com/dcolinmorgan/herdr-remote) | No asserted license at inspection; no code reused. |
| [Codex app-server](https://learn.chatgpt.com/docs/app-server), [Codex source](https://github.com/openai/codex) | Apache-2.0 protocol implementation. Used documented initialization, threads, native turns/steering/interrupt and server requests. Generated 0.161.0 schema fixtures only. |
| [Claude hooks](https://code.claude.com/docs/en/hooks), [plugins](https://code.claude.com/docs/en/plugins), [session behavior](https://code.claude.com/docs/en/how-claude-code-works) | PermissionRequest documented structured decisions; no private Remote Control API. Read native persistence conservatively; no third-party implementation copied. |
| [Hermes session storage](https://hermes-agent.nousresearch.com/docs/developer-guide/session-storage/) | Native SQLite read interface; locally fixture-tested only. |
| [OpenCode server](https://opencode.ai/docs/server/) | Documented session message HTTP read path; locally fixture-tested only. |
| [OMP sessions](https://github.com/can1357/oh-my-pi/blob/main/docs/session.md), [RPC](https://github.com/can1357/oh-my-pi/blob/main/docs/rpc.md) | Native JSONL reader, branch ancestry retained; no live writer attachment claimed. |

Dependencies use npm lockfile and standard permissive ecosystem licenses (React/Fastify/Tailwind/TanStack/Zod/SQLite). No application source from the reviewed projects was vendored. The pinned UI skills and their licenses are documented in design-skills.lock.json and included verbatim under `.agents/skills`. Their marketing-oriented automatic recommendations were rejected when unsuitable; mobile touch/navigation/accessibility guidance shaped the actual interface. Direct dependency license inventory can be inspected with `npm ls --all` and installed package LICENSE files; `npm audit --omit=dev` verifies reported production advisories.

Herdr fixture © Herdr contributors, licensed Apache-2.0; Codex generated protocol fixtures © OpenAI contributors, licensed Apache-2.0. Fixture license copies and origin notices are included beside the files. Changes in installed schemas require diagnostics and adapter contract validation, not hardcoded assumptions about future releases.
