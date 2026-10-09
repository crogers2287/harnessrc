# Claude CLI steering

Relay delivers instructions to the existing Herdr-owned Claude process using documented synchronous PreToolUse/PostToolUse/PostToolUseFailure additionalContext hooks. If Claude reaches Stop before consuming a pending instruction, the hook returns a block decision with that instruction so the current work continues. Permissions are never granted by this bridge. It does not spawn a second writer or type into a terminal.

Install after deploying the release:

```sh
python3 scripts/install-claude-steering.py \
  --release "$HOME/.local/share/relay/current" \
  --socket "$HOME/.local/state/relay/hooks.sock"
```

The installer backs up and merges settings. Claude normally reloads hook settings automatically. Relay enables Steer only after a main-thread hook checks in from a process descended from Herdr's foreground process, with matching native identity. Older processes that do not reload hooks remain unsupported until a normal resume; do not restart busy sessions automatically.

Instructions and attachment references are durable. Delivery occurs at a tool boundary, not during an in-flight model request or tool execution. Stop consumes only new requests, preventing repeated continuation. Subagent hooks never consume the parent's mailbox. Atomic claims precede output; if a hook dies after claiming, Relay does not blindly resend it. The hook acknowledges after stdout is written; this proves handoff to the native hook, not that the model obeyed the instruction. Pending input remains visible until handoff. File/image references use Claude's existing local file reader rather than injecting binary image blocks through hooks.

References: https://code.claude.com/docs/en/hooks and https://code.claude.com/docs/en/hooks-guide
