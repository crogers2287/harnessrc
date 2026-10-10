# Launch permissions and project folders

In **New session**, choose the agent, use **New project folder** to create a directory in the displayed home, select **Session permissions**, confirm the selection, and enter the first instruction. Folder creation is separate from launching: a launch failure leaves the new empty folder available to retry or browse.

For a running session, open the top-right **…** button. Permissions and mode appear first in Session settings. Refresh reloads native settings. Unsupported adapters show the reason; Relay does not silently send slash commands as chat messages. Existing Claude CLI permission changes are currently unsupported; choose the desired policy at creation.

## Installation

`launchProfiles[].permissionPresets` is trusted gateway configuration. Each entry has `id`, `name`, `description`, native `args`, and optional Codex `sandbox` and `approvalPolicy`. Clients only send the ID and confirmation. Do not configure contradictory permission flags in profile `args` or preset args. Keep policy-affecting Codex CLI flags consistent with native thread parameters.

On Fred, after checking the installed `claude --help` and `codex --help`, run:

```sh
python3 scripts/configure-launch-permissions.py
systemctl --user restart relay.service
```

The script backs up configuration and adds verified Claude modes (manual, acceptEdits, plan, bypassPermissions through its dedicated CLI flag) and Codex sandbox/approval choices. It does not alter host defaults or running sessions. DSH uses its native catalog and requires successful read-back before sending the first instruction.

Folder creation is local to the gateway host and uses the selected profile's first configured `roots` entry as project home. On Fred this is `/home/crogers2287`. The profile root must be a local filesystem path. The endpoint does not create directories on arbitrary remote hosts. To move project creation elsewhere, configure a different first root. No recursive path creation, hidden folders, existing-path replacement or client-provided commands are accepted.

A lost folder response can leave the folder created. Browse and select it; retrying creation does not overwrite it. Launch idempotency includes the selected permission, and uncertain launches require checking the existing session before retrying.
