# DSH native web integration

Relay connects to the existing DSH web host. It discovers native sessions automatically, imports ordered structured history, follows assistant text over the native multiplexed WebSocket, sends idle messages, steers active turns, and reconciles queued work by native request ID. Model selection in session details uses DSH's actual provider/model catalog. Launch profiles can create a native DSH session with a chosen folder, preset and model. No extra DSH host or second session writer is started. Herdr continues supervising its existing CLI sessions; DSH web sessions are explicitly external to Herdr.

## Configuration

```json
{
  "dsh": [{
    "id": "fred-dsh", "name": "Fred · DSH",
    "endpoint": "http://127.0.0.1:3080",
    "tokenFile": "/run/user/1000/dsh-w6800/token"
  }],
  "launchProfiles": [{
    "id": "dsh-cfrproxy", "hostId": "fred-dsh",
    "label": "DSH · CFRproxy", "harness": "dsh",
    "provider": "CFRproxy", "dshProvider": "cfrproxy",
    "defaultModel": "codex/gpt-6.1-sol",
    "workspaceId": "fred-dsh", "roots": ["/home/crogers2287"],
    "allowCustomModel": false
  }]
}
```

Merge entries with existing configuration. The token file must belong to the gateway account with mode 0600. Relay exchanges the native launch token for a native cookie kept only in memory, and detects token rotation after host restart. Never expose that token to clients or commit it. Remote endpoints require HTTPS. Session routes enforce Relay read/control grants, existing native identity and availability. Native model changes apply to the next model request; the current request keeps its model. DSH also persists its selected model as the native global default.

## Fred repair, October 8

Two services competed for port 3080. The system `dsh-web.service` ran a source checkout while user `dsh-w6800.service` repeatedly restarted. The system service was disabled and the built-runtime user service became the sole owner. Its supervisor now captures the full native login token and redacts it from output. The existing native credentials store remains the authority for CFRproxy access.

`~/.dsh/profiles/web/model-catalog.patch.yml` was not loaded by Cordis: the effective profile overlay is `cordis.patch.yml`. The overlay was installed, pointed at Fred's local CFRproxy `/v1` endpoint, and populated from its actual `/v1/models` catalog. The previous endpoint was a restricted single-model route. A backup precedes the route change. Do not substitute unqualified aliases for native catalog IDs.

Validate with `systemctl --user is-active dsh-w6800`, the native web model picker, then Relay's DSH filter and session model settings. Integration fixtures cover pagination, stream indices, exact model/provider transport, native steer mode, restart deduplication and removed sessions.

## Limits

DSH native question/approval replies, interruption, attachments and reasoning controls are not yet connected to Relay. Those capabilities remain disabled; pending questions block dispatch and must be answered in DSH. The existing DSH web host owns its lifecycle, independently of phone connections. Optional host plugins can still report their own configuration errors. Relay does not claim full DSH parity.

Protocol verified against Fred's installed MIT-licensed source: `packages/api/session-controller`, `packages/client/connection`, and compact assistant stream definitions in `packages/llm/llm`. No third-party implementation code was copied.

New sessions are selected directly with **New session → Agent → DSH**. Relay automatically selects the configured DSH connection, then offers its permitted folders and exact provider models. Conversation preparation obtains the adapter directly from native host discovery, including the interval before the background scheduler adopts it; newly launched chats therefore load history and begin watching immediately.

**DSH agent** selects the native agent preset (for example haxor, ash, or minimal) independently of provider/model. The roster and default come from DSH's `agentPresets/list` API; broken presets remain visible but disabled. Relay validates explicit selections against the current roster before recording or creating a launch, then sends the exact ID as `session/create.request.agentPreset`. The choice persists in the launch draft and participates in request idempotency. Leaving Default selected preserves the configured/native default. This controls new sessions only; existing running agents are not replaced.

## Native question bridge

Relay now maintains one authenticated `$events` stream per DSH host on `/api/remote.mux`. It accepts `user-questions/request` waterfalls, keyed by native `eventId` and `agentId`, and returns the validated complete answer batch through `$events/result` with that connection's `clientId`. DSH replays pending waterfalls when Relay reconnects, including legacy blocking `ask_user_question` calls that never appear in the `userQuestions` projection. Cards support single/multiple choices, free text and supporting detail. Replies do not invoke `session/prompt` or create an unrelated agent turn.

The implementation follows the installed DSH gateway's `stream-protocol.ts`, `openRemoteEvents`, and native question UI reply code. Unknown events are delegated, never approved. Broker claims prevent duplicate submissions; stale/disconnected owners cannot receive a reply; a lost acknowledgement remains uncertain rather than being resent. Replayed native pending requests can renew an expired transport lease. Native cancellation retires the card on reconciliation. Relay does not implement timed-continued question replies through `userQuestions/answer` yet, nor command permission approval, file uploads, or process termination for DSH.

The native `agentPreset` projection is displayed in session rows, the conversation header, and details (for example `haxor`).

Live Fred validation (2026-10-09): Relay recovered the existing haxor question batch through the native event stream without answering it. A separate haxor test session asked an actual `ask_user_question` with Alpha/Beta, received Alpha from Relay's mobile card, and continued with `Received: Alpha`. No `messages`, `tasks`, or `steer` request was used to answer it. The DSH host was not restarted.
