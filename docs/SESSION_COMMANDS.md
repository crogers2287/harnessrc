# Slash commands and quick shortcuts

Web and Android 0.1.26 expose a keyboard button beside the composer. The menu
includes Stop (Ctrl+C), Escape, Yes, Continue, No and common slash commands.
Typing `/` also displays command suggestions. Browser Ctrl+C itself continues
to copy selected text; stopping the agent requires choosing the explicit shortcut.

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
  retain the harness session. Escape uses the verified CLI's `esc` key when
  there is no pending structured interaction; other connections and pending
  interactions use native turn cancellation. There is no unrestricted key or
  shell-command injection endpoint.
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

Commands do not create a chat turn or a queued task. Native lifecycle/history
continues to be authoritative. Desktop browser dialogs are not terminal UIs:
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
