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
