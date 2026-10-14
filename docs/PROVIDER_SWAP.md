# Resume a conversation with another provider

Hold a session in the drawer and choose **Swap provider** (web and Android 0.1.18+). Select a configured provider profile, model and permission preset, then confirm. Choose a CFRproxy profile to route the resumed conversation through your proxy. Providers come from this server's configuration; no host name is hardcoded.

Relay preserves the harness, native conversation UUID, host, working directory, workspace, history and saved title. Herdr closes the old pane and launches the replacement in another pane in the same workspace. The terminal and owner generation change. This is native resume, not a new conversation seeded with a summary.

## Support and prerequisites

Currently supported: local Herdr-owned Claude Code and Codex with a native UUID and matching launch profile. The host must permit local file access; the CWD must pass allowed-root checks. Other harnesses display an unsupported explanation; supported live model controls remain available. Relay does not describe a fresh DSH/Hermes/OMP launch as an exact resume.

Finish or stop the current turn and active sub-agents, and resolve questions/approvals first. Codex children with separate Herdr owners must be closed separately. Provider credentials remain in trusted server configuration/environment. Clients cannot submit arbitrary arguments, environment, sockets or paths. New permissions require an explicit choice; full access is not silently carried to another provider.

## Lifecycle

1. Validate exact native ownership, idle state, profile, credentials, CWD, model and permissions.
2. Save an idempotent receipt, pause queued work and prepare an empty pane through Herdr.
3. Recheck idle ownership, close the old pane through Herdr, wait for its exact process to exit and verify no old native owner remains.
4. Resume and launch through Herdr. Success requires a ready replacement bound to the original native UUID.
5. Keep queued work paused for review. Old-generation tasks are not automatically retargeted.

Loaded daemon-backed Codex threads ignore provider overrides. Relay uses documented native `thread/archive` / `thread/unarchive` to unload the old runtime, restores originally unarchived idle descendants, then calls `thread/resume` with the selected provider/model/permissions before attaching the CLI. It verifies the returned provider and model. Active descendants are rejected before archival. See the [Codex app-server API](https://learn.chatgpt.com/docs/app-server).

Claude uses native `--resume <UUID>` with profile/model/permission arguments. Local Codex without a daemon uses `resume <UUID>` with those arguments. Herdr remains the supervisor.

Claude's known folder-trust startup screen is continued automatically during authorized launches/resumes. Relay verifies the selected CWD, exact Herdr pane/terminal/name, live foreground process and the specific trust menu before sending its fixed native selection through Herdr. This covers the bootstrap prompt before Claude's question hooks exist; other questions/approvals use their usual interaction path and selected permissions.

If startup hooks bind late, a receipt check can reconcile an uncertain `confirm`/`bind` result only after the exact replacement owner reports the original native conversation ID. Receipt checks never send input or launch processes. Confirmed swaps update the displayed model with a new timestamp so older history cannot restore the pre-swap model. Internal restart process names are mapped back to the original conversation title during startup as well as after binding.

## Uncertain restarts

Clients persist the original UUID/body before submitting. **Check restart** reads its durable receipt; **Retry same request** reuses the UUID and cannot start a second replacement. A definite validation rejection without a saved receipt permits editing choices. A timeout does not mean nothing happened.

Gateway restart or failed native confirmation produces an **uncertain** receipt. Relay does not automatically retry an ambiguous launch, release the restart lock or resume the queue. An operator must inspect the recorded phase, pane/terminal IDs and native ownership. SQLite `provider_swaps.receipt` includes those identifiers and, before Codex archival, the root and originally unarchived descendant UUIDs. A hard crash during archival can require native unarchive of those exact conversations. Ordinary partial failures attempt restoration; hard-crash recovery remains manual. Never blindly delete a receipt or start another owner to resolve uncertainty.

## MCP and verification

`relay_provider_options` discovers profiles. `relay_restart_provider` requires the original UUID, current generation, profile/model/permission and confirmation. `relay_provider_receipt` inspects the result after a timeout. All use the same authorization and ownership checks as the clients. See [agent control](AGENT_CONTROL.md).

A disposable live Herdr/Codex test succeeded through CFRproxy: same UUID/CWD, new terminal, confirmed provider/model. Only allocated test panes were closed. Service tests cover exact arguments, exit ordering, validation, idempotency, ambiguous launch handling, unload/resume and descendant restoration. Mobile browser tests cover the form and retained request identity. Android unit/lint/build checks pass. Physical-phone provider-swap verification and a live Claude provider-swap test remain outstanding.

### Claude through CFRproxy: internal requests and context

Relay supplies the selected provider/model as `ANTHROPIC_MODEL`, `ANTHROPIC_SMALL_FAST_MODEL`, and the default/Fable/Opus/Sonnet/Haiku model aliases on both new launches and exact-conversation restarts. Passing only `--model` leaves Claude's auxiliary requests able to use native aliases. The launch environment also carries `CLAUDE_CODE_MAX_CONTEXT_TOKENS` when the trusted model catalog advertises a positive context window. Unknown custom models receive no invented window; native-provider profiles and other harnesses retain their own environment behavior. These settings apply when the harness process starts; existing processes must be restarted through the verified provider-swap path to receive them.

Claude 2.1.300 retains the previous response model in cached compaction parameters during cross-provider resume. CFRproxy launches send `X-CFR-Model` through the native `ANTHROPIC_CUSTOM_HEADERS` setting so authenticated ordinary proxy requests use the selected target even when the client sends an old native model name. This requires the matching CFRproxy update; shared endpoints retain their own model policy. Relay never rewrites native transcripts.
