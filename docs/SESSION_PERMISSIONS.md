# Session permissions

Open a conversation → Session details (•••) → Session permissions. The selector reads the harness's current permission preset and available options. Select a preset, confirm the scope, and Apply. This changes the native session, not Relay device access, and sends no chat turn.

DSH uses its installed `permissionPresets/catalog` remote and `permissions.currentValue` session projection. Writes use the same `commands/execute` remote as its own UI, with `agentId`, `/permission <preset>`, and no attachments. Relay checks the native session binding, control permission, allowed catalog value, expected previous value and explicit confirmation, serializes local writes, audits attempts/results, and reads back the native result. Unknown native options are never invented. DSH may refuse sandbox changes while persistent terminal sessions are open; Relay preserves that restriction rather than terminating tools.

Claude CLI and Codex connections currently report permission changes unavailable. Existing per-action approvals are separate. Relay does not send a `/permission` chat prompt, auto-approve pending requests, modify a global harness configuration, or start a second writer to simulate this setting.

Tests cover native payload/routing, stale settings, invalid presets, read/control authorization, explicit confirmation, browser selection and confirmation. Live changes are tested only on a disposable native session, with its initial setting restored.
