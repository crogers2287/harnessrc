# Zcode on Fred

Relay connects to the public `zcode app-server` protocol through a private Unix
socket. One bridge process owns Relay's separate Zcode session database. It never
attaches a second writer to an existing desktop or terminal session.

Fred uses `zcode-app-cli@3.16.3-39`, the community terminal client containing the
Z.ai runtime, installed under `~/.local/share/zcode/cli`. Its public executable is
`~/.local/bin/zcode`. Upstream: https://github.com/kingsword09/zcode-cli and
https://github.com/zai-org/ZCode.

1. Install: `npm install --prefix ~/.local/share/zcode/cli zcode-app-cli@3.16.3-39`.
2. Link `~/.local/bin/zcode` to `~/.local/share/zcode/cli/node_modules/.bin/zcode`.
3. Run `zcode login zai --no-browser` and authorize the displayed URL.
4. Install `deploy/relay-zcode.service` as a systemd user unit and enable it.
5. Add the trusted host/profile below to Relay's configuration, then restart Relay.

```json
{
  "zcode": [{
    "id": "fred-zcode", "name": "Fred · Zcode",
    "socket": "/home/crogers2287/.local/state/relay/zcode/native.sock"
  }],
  "launchProfiles": [{
    "id": "zcode-zai", "hostId": "fred-zcode", "label": "Zcode · Z.ai Coding Plan",
    "harness": "zcode", "provider": "Z.ai Coding Plan", "workspaceId": "fred-zcode",
    "roots": ["/home/crogers2287"], "allowRootSymlinks": true,
    "defaultModel": "GLM-5.3", "zcodeProvider": "account:zai-individual-coding-plan",
    "models": [{"id": "GLM-5.3", "name": "GLM-5.3"}, {"id": "GLM-5.3-Flash", "name": "GLM-5.3-Flash"}]
  }]
}
```

These are additional entries, not a replacement for the existing configuration.
The native catalog verifies account access and reasoning settings on launch.
Credentials stay in Zcode's private credential store. The bridge uses CLI-owned
authentication; do not set `ZCODE_APP_SERVER_AUTH_MODE=host`.

Both existing web and Android clients obtain profiles and capabilities from the
gateway. Supported: launch, live conversation text, history replay, follow-ups,
queue, interruption, native approvals/questions and model selection.
The installed runtime does not reliably confirm permission-mode changes, so
Relay uses its default Build mode and does not expose mode overrides.
File attachments, browser host tools and active-turn steering are not advertised.
Official MCP tools requiring desktop-supplied authentication remain unavailable.

The bridge stores native sessions and durable dispatch receipts in
`~/.local/state/relay/zcode`. A gateway restart reconnects to the same owner.
A bridge restart changes its generation, invalidating outstanding control
requests; uncertain messages are never blindly resent. Only Relay-created
sessions in this isolated database are controlled.
