# Slash commands and quick shortcuts

Web and Android 0.1.26 expose a keyboard button beside the composer. The menu
includes Stop (Ctrl+C), Escape, Yes, Continue, No and common slash commands.
Typing `/` also displays command suggestions. Browser Ctrl+C itself continues
to copy selected text; stopping the agent requires choosing the explicit shortcut.

Web and Android 0.1.33 send with Enter. Ctrl+Enter (also Shift+Enter) inserts a
newline. Android's software keyboard Send action submits the draft; composition
does not submit. With an empty composer, no attachments and an active turn,
the primary button becomes **Stop turn**. Browser Escape and Android hardware
Escape preserve the draft and use the same `/esc` control route. Browser Escape
closes an open dialog before controlling the session. These controls require a
connected, writable session with Escape or native interruption capability.

- `/help` opens Relay's quick shortcuts. `/model` and `/permissions` open the
  existing session settings. `/tasks` opens task progress; `/agents` opens the
  child-conversation viewer where supported.
- `/plan` uses the verified native mode API when available; otherwise it is
  dispatched as a native slash command. It does not send a planning prompt to
  the model. `/compact` uses Codex's existing daemon compaction RPC, DSH's
  command executor, or the verified interactive CLI, as appropriate.
- Other well-formed, single-line slash commands are submitted to the existing
  interactive CLI through Herdr's `agent.prompt`, or DSH's `commands/execute`.
  The native harness parses them and determines support; Relay does not invent
  a successful execution or turn an unsupported native command into AI chat.
  CLI acknowledgement means submitted, not that every command has finished.
  Sessions without a verified interactive CLI cannot use that fallback.
- Stop, `/stop`, `/cancel`, and `/ctrl-c` use the native interruption API and
  retain the harness session. Escape sends the literal `esc` key to a verified
  Herdr-owned CLI, including while a question is pending. It does not submit an
  answer or approve anything. Connections without a terminal use their native
  turn cancellation API. There is no unrestricted key or shell-command injection
  endpoint.
- Yes, Continue, and No are ordinary messages/steering, never approval replies.
  Their buttons are disabled while waiting for an answer; use the exact native
  question card instead. Quick replies preserve a different draft, attachments,
  and dictation state. Commands carry no attachments and cannot be queued.

Commands require authenticated control access, current session generation and
verified binding. Direct child-session controls remain read-only. Settings and
command writes share a per-session guard. Clients save request IDs before
native dispatch; confirmed repeats return the original receipt. An uncertain
command is never blindly repeated, and subsequent native commands in that
owner generation are blocked. Inspect the native state and use the verified
restart/resume workflow if acknowledgement cannot be recovered. Read-only
settings navigation and cancellation remain available.

Relay does not turn slash commands into ordinary messages or queued tasks.
A native command can itself start or continue work, as Claude /goal does. Native
lifecycle/history continues to be authoritative. Desktop browser dialogs are not terminal UIs:
commands that open a native interactive-only menu may still require that CLI;
Relay's model, permission, task, and agent shortcuts use app controls instead.

Validation includes shared API tests for native routing, state/ownership fences,
question blocking, queue rejection, request reuse, uncertain delivery, DSH
execution, Codex mode dispatch and Escape. Browser checks cover slash dispatch,
quick replies, retained drafts and mobile width. Android unit tests, lint and
APK/test APK builds run locally. The new Android instrumentation test covers
shortcut delivery and draft preservation but was not executed: the disposable
AVD's system-image directory has no kernel/system image. Physical-device menu,
keyboard and font-scale validation remains outstanding.

## Native goals and harness-specific suggestions

Codex `/goal <objective>`, `/goal pause`, `/goal resume` and `/goal clear` now
use the existing verified owner's `thread/goal/get`, `thread/goal/set` and
`thread/goal/clear` RPCs, with explicit user provenance. `/goal` opens Agent tasks.
Multiline objectives are supported through this API; other terminal commands
remain single-line. Goal changes do not create a message, a queued follow-up or
a new thread. Codex owns goal continuation and stopping conditions. Pause can be
requested while a turn/question is active; it does not answer that question or
cancel the current turn. Resume/new objectives require resolving pending input.
An acknowledgement lost during mutation retains the existing uncertain-command
fence; reading the native goal remains available without replaying the command.

Agent tasks shows the goal objective, native lifecycle state, consumed tokens,
optional budget, and elapsed time. Pause/Resume preserve the main chat draft.
The goal is polled every five seconds while the task view is open. Empty,
unsupported and unavailable are separate states; goal completion is independent
of whether the latest conversation turn is idle. Unsupported native servers are
identified explicitly. Claude/DSH/other harness commands retain their own native
executor/verified CLI; Relay does not translate their `/goal` into a Codex goal.
Those connections currently do not expose a structured goal snapshot to Relay.

Both clients read command suggestions from their session detail response rather
than offering one global list for every harness. `/status` opens details and
`/approvals` aliases permission settings. `/model <native-model-id>` (or
`provider/model-id`) and `/permissions <native-option>` use offered settings
through the adapter, when available. `/plan on` and `/plan off` use native mode
settings. Invalid choices are rejected before recording delivery, preserving a
subsequent corrected command. Other slash commands retain the native fallback
and its interactive-menu limitations described above.

Native goal contracts were checked against JSON schemas generated by the
installed Codex 0.165.0 binary (`app-server generate-json-schema --experimental`).
See [OpenAI's Goals guide](https://developers.openai.com/cookbook/examples/codex/using_goals_in_codex)
for native lifecycle behavior. No new daemon or provider dependency is required.


### Claude Code goals, Android 0.1.39

Claude `/goal <condition>` and `/goal clear` go to the existing verified CLI,
including while it is working. Claude declares `/goal` immediate; Herdr's
`agent.prompt` accepts working sessions. Pending native questions still block
changes. Bare `/goal` opens Agent tasks. Claude does not offer Codex's goal
Pause/Resume syntax; those words are rejected instead of becoming new conditions.
The native condition limit is 4000 characters; terminal commands remain one line.

Agent tasks reads Claude's exact session transcript `attachment.goal_status`
records, using an independent bounded incremental cursor. Parent identity and
sidechain checks isolate goal history from child agents. Active, completed,
failed and explicitly cleared states follow native markers. Missing goal records
are shown as unrecorded, not unsupported or proof that an in-memory goal is absent.
No objective is inferred from ordinary conversation, project files or a command
submission receipt. Counters appear only when native records include them; Claude
usually supplies token/time totals at completion. Clear replaces Codex-specific
Pause/Resume in both clients. The Tasks view includes session/harness identity.

Contracts were inspected in the installed Claude Code 2.1.311/2.1.312 command
implementations and Herdr's bundled API/CLI documentation. Regression fixtures
cover native marker lifecycle and CLI dispatch; Pegfall was inspected read-only,
without setting or clearing its goal. Native emulator UI execution remains
unverified on this host.
