# Relay helper

Open **Helper** in the session drawer or chat header, or swipe inward from the
right edge. Choose a proxy connection and model and send an instruction.
The helper is an independent agent owned by Relay's gateway. It calls the proxy
chat API directly, with the existing Relay function tools. It has no Codex/DSH/OMP
CLI process, Herdr pane, ordinary session entry, terminal or general shell access.
Its private conversation and drafts remain separate from the session you viewed.

## Portable configuration

Configure `helperConnections` in the gateway JSON, for example:

```json
{
  "helperConnections": [{
    "id": "my-proxy",
    "label": "My proxy",
    "baseUrl": "http://127.0.0.1:8420/v1",
    "defaultModel": "your-model-id",
    "models": [{"id": "your-model-id", "name": "My model"}],
    "apiKeyEnv": "MY_PROXY_API_KEY"
  }]
}
```

`baseUrl` is an OpenAI-compatible proxy API root. Models are discovered from its
`/models` endpoint, with the configured catalog as fallback. Omit `apiKeyEnv`
when the proxy does not require credentials; otherwise set that environment
variable on the gateway. Use HTTPS for nonlocal proxies. No host, account, or
model is built into either client. Only server administrators configure endpoints.
The old launch-profile `helper` flag no longer creates or configures this agent.

The detailed [operating prompt](HELPER_PROMPT.md), prepared with prompt-master,
is installed as system instructions. It documents Relay and Herdr identities,
capabilities, pending interactions, receipts, cleanup, monitoring and uncertainty.
Its complete tool inventory comes from the same MCP implementation used by
external agents, restricted to authenticated Relay operations. Local-file upload
is excluded because this agent has no filesystem tools. A short-lived internal
credential retains the initiating administrator device's authority, is checked on
every API action, and is deleted when the turn ends. Revocation still applies.

> This prompt is for an agentic tool with real system access. Review the scope locks, forbidden actions, and stop conditions before pasting. Confirm file paths, directories, and permissions match the actual project.

Conversations live in dedicated `helper_chats` storage, never the session table.
One current conversation is bound to each authorized device. New chat preserves
the previous database history. Initial messages and follow-up messages use durable
UUID receipts; replay never starts another turn. Replies stream through the proxy
and both drawers refresh the private state each second while open. Stop cancels
the helper model request; completed session-management actions remain applied.
A gateway restart stops unfinished helper turns without replaying tool actions.
Each turn is limited to 20 model steps and bounded response/history sizes.

Legacy helpers created by Android 0.1.34/0.1.35 are excluded from the ordinary
session feed only when their saved helper binding and launch receipt prove the
exact native identity. Their process and original transcript are preserved; the
new agent does not resume that coding session. Private archived helper chats are
currently retained in the database; only the current private chat is exposed by
the drawer.

## Attention and notifications

When a helper connection is configured, the gateway checks every 30 seconds for pending
native questions/approvals and emits one reminder per interaction after five
minutes. Set `"helperAttention": { "enabled": true, "waitingMinutes": 5 }` in the
gateway JSON configuration to customize this. Disabled monitoring, disconnected,
ended, archived, expired and replaced-owner interactions produce no reminder.
The monitor never answers or approves anything and does not poll an LLM.

The helper's **Waiting** list opens the actual session question. `relay_attention`
reads this state; `relay_notify` publishes an authorized session-linked notice
with the exact generation and a retained idempotency UUID.

On Android enable **Settings → Background notifications** and grant notification
permission. The existing foreground connection service receives alerts while the
Activity is backgrounded. Force-stop, network loss and OS background restrictions
can delay delivery. Notification preview preferences also cover helper alerts.

On web grant browser notification permission and enable Relay notifications.
A connected tab/PWA is required; this release does not add closed-browser Web
Push. Accepted/stored notices are not proof that a device displayed them.

## Native composer controls

Both clients show a horizontally scrollable strip below the composer for token
counts, model, thinking level, permissions and agent mode when available. Tap to
edit through the native session API. Model/thinking changes apply to subsequent
requests. Permission/mode changes retain confirmation and expected-value checks.
These controls do not send chat instructions or introduce a second writer.

Codex, DSH and Zcode expose supported model/thinking choices through their native
catalogs. Claude connections lacking live model controls offer the existing
confirmed provider-resume flow instead. Unsupported controls explain the limit.

Codex supplies cumulative counters and the latest context count. Claude and DSH
supply per-request native counters; Relay includes cache input and deduplicates
repeated snapshots. Details distinguish context from accumulated session use.
Zcode supplies native session totals and context/window counters; unavailable
input/output subtotals remain unreported. No values are estimated from text.
Harnesses without counters show **not reported**. Counts reflect imported/retained
native history and may be incomplete for a newly attached session.

Review screenshots: [web helper](screenshots/helper-mobile.png), [web controls](screenshots/composer-settings-mobile.png), [Android controls](screenshots/native-composer-settings.png), [Android keyboard](screenshots/native-composer-settings-keyboard.png).
