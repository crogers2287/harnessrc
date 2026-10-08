# Codex Cloud Build Assignment: Universal Agent Remote

## Mission

Build a production-oriented, self-hosted, cross-platform conversational remote-control application for coding agents.

The system must work **on top of Herdr**, using Herdr as the existing process/session supervisor. Do not replace, fork, or duplicate Herdr's core supervision functionality unless absolutely necessary.

The user currently manages persistent Claude Code and Codex sessions on a Linux server named Fred using Herdr. Other harnesses include Hermes, OpenCode, and OMP.

The target experience is the Claude Code integration in Anthropic's Android/iOS Claude application: a polished, native-feeling chat interface for an agent running elsewhere.

This is NOT a remote terminal application.

The user must be able to control existing live coding-agent sessions from a phone without interacting with terminal interfaces, terminal escape sequences, or manually navigating interactive CLI menus.

**The result should resemble a universal Claude Code mobile application, capable of connecting to many different coding harnesses.**

## Non-negotiable requirements

1. Herdr remains responsible for process persistence, panes, workspaces, session ownership, and lifecycle control.
2. Any supported session started inside Herdr should appear automatically in the application, without requiring the user to launch it through our app.
3. The mobile interface must display structured conversations rather than raw terminal output.
4. The application must detect and handle agent questions, approvals, requests for input, and blocked states.
5. Users must be able to queue follow-up instructions while an agent is working.
6. Users must be able to reply to questions without interrupting unrelated work or inadvertently creating another turn.
7. Sessions must remain usable from their original Herdr terminal at the same time they are viewable through the application.
8. The application must function on Android, iOS, and desktop browsers.
9. Disconnecting the phone must not interrupt the agent.
10. The gateway must recover session state and queued tasks after restart.
11. All remote operations must be authenticated and authorized.
12. No raw terminal scraping as the primary conversation protocol.
13. Do not depend on Anthropic's private or undocumented Claude Remote Control APIs.
14. A feature must not be presented as supported unless the corresponding adapter can safely execute it.

## Starting instructions: inspect the repository and environment

Before implementing, inspect the selected repository and determine whether useful code already exists.

Study:

- Herdr: https://github.com/herdrdev/herdr
- Herdr documentation: https://herdr.dev/docs/socket-api/
- Herdr Chat: https://github.com/eliasstravik/herdr-chat
- Corral: https://github.com/neptunix/corral
- Herdr Remote: https://github.com/dcolinmorgan/herdr-remote
- Official Codex app-server documentation and protocol implementation
- Claude Code's documented hooks, session persistence, and plugin architecture
- Hermes native session interfaces
- OpenCode server and session APIs
- OMP's native session/event interfaces

Review compatible licenses and dependencies before reusing third-party code.

Do not assume the cloud environment has access to Fred, its Tailscale network, Herdr sockets, or the user's private session data.

First determine what can be implemented and verified locally with mocked fixtures. Create an installation package and integration diagnostics for testing against Fred.

Run:

- `herdr --version`
- `herdr api schema --json`
- Inspect supported Herdr socket methods and integration APIs.

When these commands are unavailable in the cloud environment, use the official source documentation, then validate against the installed binary during deployment.

Do not invent undocumented APIs.

## Architecture

Use a TypeScript monorepo.

Proposed layout:

- `apps/web` — Responsive React application and installable PWA.
- `apps/gateway` — Fastify HTTP/WebSocket server.
- `packages/protocol` — Shared types, event schemas, validators, and capability definitions.
- `packages/herdr` — Herdr connection, session discovery, lifecycle tracking, and command transport.
- `packages/adapters` — Harness-specific conversation and interaction adapters.
- `packages/interaction-broker` — Questions, approvals, responses, and pending interactions.
- `packages/task-queue` — Durable queued commands and dispatch scheduling.
- `packages/client-sdk` — Typed client protocol and reconnect handling.
- `packages/ui` — Reusable interface components.
- `packages/testing` — Fixtures, mock harnesses, simulators, and contract tests.
- `docs` — Architecture, setup, security, protocol, deployment, and troubleshooting.

Use React, TypeScript, Tailwind CSS, SQLite, Zod, WebSockets, and a practical query/state-management library.

The primary gateway should run as a systemd-managed service on Ubuntu.

Use a modular adapter architecture. Avoid putting harness-specific logic directly into UI components or the shared gateway.

## Herdr integration

Use Herdr's documented socket API, including the methods supported by the installed version:

- `session.snapshot`
- `events.subscribe`
- `agent.list`
- `agent.get`
- `agent.prompt`
- `agent.wait`
- `agent.explain`
- `agent.read`
- `pane.get`
- `pane.report_agent_session`
- Other applicable documented methods.

Use the installed protocol schema as authoritative.

The gateway must:

- Discover live Herdr sessions.
- Identify the harness.
- Track the native session identifier.
- Track the workspace, pane, host, and process identity.
- Subscribe to lifecycle changes.
- Recover state after Herdr reconnects.
- Detect session termination or replacement.
- Maintain an authoritative mapping between remote sessions and Herdr processes.
- Avoid reusing stale pane identifiers after process replacement.

A session must never be duplicated merely because its pane identifier, window, or workspace changes.

Sessions not started through the application must be discoverable.

Support multiple Herdr installations and servers in the underlying data model, even if the first deployment targets only Fred.

## Universal conversation protocol

Design a normalized event protocol with stable ordering and durable replay.

At minimum support:

- User message
- Assistant message
- Assistant text delta
- Reasoning summary
- Tool invocation
- Tool output
- Tool completion
- File change
- Diff
- Question
- Approval request
- Approval response
- Plan
- Progress update
- Agent status update
- Subagent creation/completion
- Turn started/completed/failed
- Task queued/dispatched/completed
- Connection state changes

Every event needs stable identity, source, timestamp, sequence/order information, and native-session linkage.

Use source-specific event IDs where available. Prevent duplicate transcript entries across replay, reconnection, and process restart.

Keep immutable raw source event payloads where useful for debugging, with sensitive values redacted.

Do not falsely present guessed reasoning or inferred decisions as native structured data.

## Harness adapters

Implement an explicit capability model:

- `readConversation`
- `streamConversation`
- `sendMessage`
- `steerActiveTurn`
- `queueTask`
- `answerQuestion`
- `approveAction`
- `rejectAction`
- `interruptTurn`
- `resumeSession`
- `attachFiles`
- `readDiffs`
- `readSubagents`

Support three broad ownership modes:

1. **Herdr-owned CLI session:** The existing CLI process owns the live agent session.
2. **Gateway-owned native session:** The gateway owns a supported native agent protocol connection.
3. **Observed external session:** The gateway can read the session but cannot safely control every interaction.

Do not attach a second writer to a CLI-owned native session using a separate app-server instance.

Start with real Claude Code and Codex adapters.

Use structured native transcripts for history, native hooks/events where possible, and Herdr for process-level management.

For Codex app-server, use its documented thread, turn, streaming, steering, and interactive-response facilities only in appropriate ownership modes.

For Claude, investigate documented hook/permission integration options and CLI session behavior.

For Hermes, OpenCode, and OMP, implement adapter scaffolding and at least a working conversation read path where their documented interfaces permit.

Do not claim universal rich-interaction support if the harness cannot expose the required protocol.

## Interaction broker — highest priority

This component is the project's most important differentiator.

When a harness needs input, convert its native request into a structured interaction.

Supported types:

- Free-text response
- Single-choice question
- Multiple-choice question
- Confirmation
- Plan approval
- Command execution approval
- File-edit approval
- Credential/authentication handoff
- Error resolution

Every interaction should include:

- Unique interaction ID
- Native request ID
- Session/turn identity
- Source harness
- Interaction type
- Prompt/question
- Available choices
- Optional default
- Response validation schema
- Expiration and status, where applicable
- Safe native response adapter
- Appropriate capabilities

The mobile client should display a suitable native component: text field, radio group, checkboxes, approval card, diff review, or plan review.

Submitting a response must resolve the **specific pending native interaction**.

It must not be implemented as a generic new user chat message unless the native protocol explicitly treats that as the response.

For terminal-owned sessions, implement an exact prompt-recognition/response adapter only when reliable validation and routing are possible.

Never automatically approve commands based on model-generated text.

Include comprehensive integration tests for pending interaction handling, double submission, stale interactions, expired requests, reconnects, and session replacement.

## Persistent task queue — highest priority

Build a per-session durable task queue.

Users must be able to submit more work while an agent is busy.

Task records should contain:

- Task ID
- Session ID
- Native-session identity
- Prompt and attachment references
- Creation timestamp
- Priority/order
- Dispatch eligibility
- Dispatch attempts
- Execution correlation
- Current status
- Completion/failure information

Provide operations to:

- Add task
- Edit pending task
- Reorder pending tasks
- Cancel pending task
- Inspect task history
- Pause and resume dispatch
- Optionally steer the current turn when safely supported

Separate these actions:

**Respond:** Resolve a blocking native interaction.

**Steer:** Modify an active turn through an actual supported native steering mechanism.

**Queue:** Persist a future turn to execute only when the agent is eligible.

Dispatch tasks serially for each session, unless a harness explicitly supports another safe execution mode.

Use atomic task claiming and idempotency keys.

Never send the same task twice because of a gateway restart or dropped connection.

If delivery occurred but confirmation was lost, mark delivery uncertain and reconcile before retrying.

Do not dispatch pending tasks while an unresolved question or approval blocks the session.

## Mobile application

Build the UI as a responsive PWA first, with architecture compatible with later Capacitor packaging.

The interface should be visually inspired by Claude's mobile chat experience but use original branding, assets, and implementation.

Required screens:

1. Session inbox
2. Conversation
3. Pending questions and approvals
4. Task queue
5. Session details
6. Host and connection settings
7. Notification settings

### Session inbox

Display:

- Project name
- Harness
- Host
- Current status
- Last activity
- Brief latest-message preview
- Pending question indicator
- Queued-task count
- Unread status

Support filtering and searching by project, harness, host, and status.

### Conversation

Use a first-class chat layout, not a terminal emulator.

Include:

- User/assistant message bubbles
- Streaming responses
- Markdown and syntax highlighting
- Expandable tool cards
- Diffs and file changes
- Question cards
- Approval cards
- Progress status
- Queue access
- Composer with attachments
- Scroll restoration
- Conversation pagination and virtualized history

The composer should allow explicit Queue, Respond, or Steer behavior based on available session capabilities.

Make typing and submitting commands comfortable on small Android/iOS screens.

### Notifications

Add browser notifications/PWA support initially and provide the architecture for native push notifications later.

Notify when:

- An agent needs an answer.
- An approval is pending.
- A task is complete.
- A session has failed.

Suppress redundant notifications and provide deep links into the exact relevant interaction.

Do not claim reliable closed-app iOS/Android push notification behavior without implementing and testing the required platform infrastructure.

## Remote-control plugin

Implement a plugin/bridge approach for harness-specific registration and optional commands.

Proposed remote command interface:

- `/rc`
- `/rc status`
- `/rc off`
- `/rc readonly`
- `/rc name`
- `/rc qr`

Do not overwrite existing built-in harness commands, particularly Claude's native `/rc`.

Use a namespaced alternative where conflicts exist.

For Herdr-managed sessions, automatic detection should be sufficient; users should not need to manually activate a plugin simply to see a session.

If a native harness cannot safely support a slash-command extension, provide a wrapper, hook, or gateway registration mechanism instead.

## Security

Treat the gateway as a high-privilege remote code-execution control surface.

Implement:

- Local Herdr socket isolation
- Authenticated API and WebSocket connections
- Device registration and revocation
- Per-session read/control permissions
- Short-lived access tokens
- Explicit authorization for destructive actions
- Replay protection
- Auditable remote commands
- Secret redaction
- Secure token storage
- Rate limits
- Strict validation of session ownership

Prefer Tailscale for the initial private deployment.

Do not expose Herdr directly to the internet.

Avoid collecting or persisting unnecessary secrets from transcripts.

## Developer experience and delivery

Provide:

- Clear README
- Complete local setup
- Docker Compose or native service options for the gateway
- systemd service template
- Example configuration with documented settings
- Database migrations
- Mock Herdr server/fixture runner
- Automated unit tests
- Integration tests
- Browser end-to-end tests
- CI workflow
- Setup and troubleshooting documentation
- Deployment instructions for Ubuntu/Fred
- Screenshot examples of the running interface

Use a mock harness capable of emitting realistic streamed messages, tool activity, questions, approvals, and task state. It must support an end-to-end demonstration without requiring credentials or production access.

No placeholder implementations presented as finished features.

## Delivery phases

### Phase 1: Working vertical slice

Deliver a usable PWA with:

- Herdr discovery
- Live session inbox
- Structured transcript rendering
- Send message to an idle supported session
- Real-time updates
- Durable task queue
- Question/approval handling for at least one genuine native interaction pathway
- Authentication
- Reconnection and replay
- Tested mock harness

### Phase 2: Rich integration

Complete native Claude/Codex integration, expand native interaction support, improve task steering, add diffs, file support, and subagents.

### Phase 3: Cross-harness and mobile polish

Expand Hermes, OMP, and OpenCode integration. Add polished mobile behavior, notifications, multi-host support, and device management.

Keep the project runnable after each phase.

## Acceptance tests

The principal end-to-end test:

1. Start Claude Code or Codex under Herdr on a Linux host.
2. Open the mobile application.
3. See the existing session appear automatically.
4. Open a complete, correctly ordered structured conversation.
5. Submit a task from the chat composer.
6. Observe the response streaming.
7. Trigger a genuine native question or approval request.
8. See a structured mobile interaction card.
9. Respond through that card.
10. Confirm the original agent continues correctly.
11. Queue two follow-up tasks while the agent is busy.
12. Confirm the scheduler executes them in order when eligible.
13. Disconnect the client during execution.
14. Reconnect and recover conversation, pending interactions, and task state without duplication.
15. Restart the gateway and verify queue recovery.
16. Verify the original Herdr terminal session remains usable.

If the cloud environment cannot access a real Herdr instance, complete mock-backed tests, report which live tests remain unverified, and supply executable validation steps for Fred.

## Working instructions

Start by inspecting the repository and researching the exact APIs. Then implement immediately.

Do not stop after generating a proposal, design document, or checklist.

Write the actual code, tests, migrations, deployment files, and documentation.

Work in incremental commits on a feature branch. Run tests and linting. Fix failures. Continue implementing until the usable Phase 1 vertical slice is complete, or a genuine external blocker prevents further progress.

Do not request routine decisions about architecture, folder structure, styling, or dependencies. Make reasonable choices and document them.

Do not overwrite unrelated repository changes.

Avoid premature complexity such as microservices, Kubernetes, or external message brokers. A modular monorepo, SQLite, and one gateway process are sufficient initially.

Use feature detection and adapter capability flags rather than hardcoded assumptions.

At completion, provide:

1. GitHub pull request with implemented code.
2. Features actually working.
3. Harness capability matrix showing implemented, partial, and unsupported functions.
4. Automated test results.
5. Fred deployment instructions.
6. Exact remaining blockers for full Claude Code and Codex interactive parity.
7. Next implementation priorities.

**Success means a genuine chat-first mobile remote-control system operating over Herdr, with native agent questions and durable queued work—not a terminal viewer with a prettier interface.**