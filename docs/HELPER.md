# Relay helper

Open **Helper** in the session drawer or chat header, or swipe inward from the
right edge. Choose a configured proxy connection and model, then send an initial
instruction. This is a regular Herdr-owned native conversation with its own draft,
queue, history and receipts. Closing it preserves the session you were viewing.
**New conversation** leaves the previous helper available in Sessions.

## Portable configuration

Add `"helper": true` to a trusted Claude Code or Codex launch profile that already
uses your CFR/VCFR proxy and has `modelsEndpoint` configured. Relay uses that
profile's host, allowed roots, native harness, proxy environment and model catalog.
No Fred address, FlashNext model, account or existing session is built in.
Catalog credentials remain server-side. See [provider configuration](PROVIDER_SWAP.md).

The native harness on that host must have Relay MCP installed and authorized:
follow [agent installation](AGENT_INSTALL.md). Read-only access can inspect;
mutations and helper notices require a permitted writable connection. Restrict
the MCP connection to the hosts/sessions it should manage. Herdr should launch
the helper in a managed pane. Native provider authentication stays on the host.

The detailed [operating prompt](HELPER_PROMPT.md), prepared with prompt-master, is
delivered as native developer/system instructions separately from the first user
message. It covers identities, capabilities, receipts, Herdr discovery, pending
interactions, cleanup, recovery, notifications and uncertainty. This agent has
real system access through its coding harness: review its authorized scope,
forbidden actions and stop conditions before enabling another installation.

> This prompt is for an agentic tool with real system access. Review the scope locks, forbidden actions, and stop conditions before pasting. Confirm file paths, directories, and permissions match the actual project.

Each authorized device has one current helper binding. Clients save the exact
launch UUID before mutation and retain it for uncertain-delivery recovery. They
never automatically repeat a launch. Another device can choose its own helper.

## Attention and notifications

When a helper profile is enabled, the gateway checks every 30 seconds for pending
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
