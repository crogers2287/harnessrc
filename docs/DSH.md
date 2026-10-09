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

DSH native question replies are connected through the bridge below. Command approvals, interruption and reasoning controls remain unsupported. Native image/file input is connected for Send, Queue and Steer when the installed host exposes its upload route. Pending live questions block task dispatch. The existing DSH web host owns its lifecycle, independently of phone connections. Optional host plugins can still report their own configuration errors. Relay does not claim full DSH parity.

Protocol verified against Fred's installed MIT-licensed source: `packages/api/session-controller`, `packages/client/connection`, and compact assistant stream definitions in `packages/llm/llm`. No third-party implementation code was copied.

New sessions are selected directly with **New session → Agent → DSH**. Relay automatically selects the configured DSH connection, then offers its permitted folders and exact provider models. Conversation preparation obtains the adapter directly from native host discovery, including the interval before the background scheduler adopts it; newly launched chats therefore load history and begin watching immediately.

**DSH agent** selects the native agent preset (for example haxor, ash, or minimal) independently of provider/model. The roster and default come from DSH's `agentPresets/list` API; broken presets remain visible but disabled. Relay validates explicit selections against the current roster before recording or creating a launch, then sends the exact ID as `session/create.request.agentPreset`. The choice persists in the launch draft and participates in request idempotency. Leaving Default selected preserves the configured/native default. This controls new sessions only; existing running agents are not replaced.

## Native question bridge

Relay now maintains one authenticated `$events` stream per DSH host on `/api/remote.mux`. It accepts `user-questions/request` waterfalls, keyed by native `eventId` and `agentId`, and returns the validated complete answer batch through `$events/result` with that connection's `clientId`. DSH replays pending waterfalls when Relay reconnects, including legacy blocking `ask_user_question` calls that never appear in the `userQuestions` projection. Cards support single/multiple choices, free text and supporting detail. Replies do not invoke `session/prompt` or create an unrelated agent turn.

The implementation follows the installed DSH gateway's `stream-protocol.ts`, `openRemoteEvents`, and native question UI reply code. Unknown events are delegated, never approved. Broker claims prevent duplicate submissions; stale/disconnected owners cannot receive a reply; a lost acknowledgement remains uncertain rather than being resent. Replayed native pending requests can renew an expired transport lease. Native cancellation retires the card on reconciliation. Relay does not implement timed-continued question replies through `userQuestions/answer` yet, nor command permission approval, file uploads, or process termination for DSH.

The native `agentPreset` projection is displayed in session rows, the conversation header, and details (for example `haxor`).

Live Fred validation (2026-10-09): Relay recovered the existing haxor question batch through the native event stream without answering it. A separate haxor test session asked an actual `ask_user_question` with Alpha/Beta, received Alpha from Relay's mobile card, and continued with `Received: Alpha`. No `messages`, `tasks`, or `steer` request was used to answer it. The DSH host was not restarted.

### Waiting without a phone deadline

Relay holds each timed native question with `userQuestions/attachWait` on the host's authenticated WebSocket, using the exact `agentId` and `callId` from its forwarded request. It does not run the native web UI's countdown. The claim lasts until the native question settles; closing or backgrounding Relay on a phone does not release it. Answer acknowledgement precedes claim release. Ending an individual claim stream does not close the host-wide question channel. Replayed requests reacquire their holds without duplicate claims.

This suspends DSH's unattended timer while the Relay gateway connection stays up; it does not rewrite DSH's own policy. A gateway/DSH connection loss can release the last hold and let an already-passed native deadline expire. Another native UI can still explicitly time out, cancel, or answer the question. DSH's timed tool also supports `timeout: -1` for indefinite native questions, but changing its tool/profile defaults requires separate native configuration and does not retroactively reopen an expired call.

Relay retires uncertain DSH cards once a healthy native question subscription confirms the request no longer exists. It never retries an uncertain answer or invents a successful response. Questions that already timed out cannot be reopened as the original blocking tool call; native continued-question replies remain a separate unsupported pathway.

Regression verification covers a held deadline, duplicate replay, reconnection/reclaim, acknowledgement-before-release, claim-stream completion, and retiring an uncertain card without another prompt. Fred's running server accepted the exact attachWait stream argument shape; the installed native TimedQuestionWait was separately verified to remain live beyond its deadline while held.


### Image/file input and steering receipts

Relay submits supported images as native `session/prompt` image parts (MIME, original name and base64 bytes). Other files are uploaded to DSH's authenticated `/api/session/uploadFileBinary?sessionId=...&name=...` route, then referenced by the returned session-scoped receipt. DSH owns durable attachment admission. Relay checks each upload's session, native owner, generation and checksum before dispatch; no host-local path text substitutes for native attachments. The installed route is feature-detected with a non-mutating admission probe without a session ID (400, `sessionId is required`).

Steering uses `mode: steer` and the **same durable Relay request ID** on the native prompt. DSH applies this at its next step boundary, potentially after an in-flight tool/model call. An acceptance receipt is not proof the model has consumed the input. Relay displays “Steering accepted” while awaiting the exact native echo; that echo carries the uploaded previews. Retries with the same Relay key do not resubmit. A lost acknowledgement remains uncertain.

DSH's `$events/result` success response legitimately omits `value` for a void return. Relay accepts that envelope; `session/prompt` still requires `{accepted:true}`. The earlier required-value parser could report “Invalid request” after DSH had already accepted a question answer.

On Fred, the `llm-pi-ai` provider catalog incorrectly declared `cfrproxy` model `fred/flash-next` with `input: [text]`. Its entry was corrected to `[text, image]` through `settings/mutate`, fenced by the settings revision; no agent restart or blanket provider override was used. The isolated native validation session then read a proof string from a file and described an uploaded icon using Flash Next. For other deployments, inspect the model's own catalog entry before assuming an image admission rejection describes the actual upstream model capability.
