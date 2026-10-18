# Herdr task exhaustion and a dead API listener

Use Herdr **0.9.5 or newer** for this failure. The 0.9.4 changes include
fallible worker-thread spawning; 0.9.2 also keeps the API accept loop alive
after transient accept errors. See the [upstream release notes](https://github.com/herdrdev/herdr/releases/tag/v0.9.4)
and [connection worker implementation](https://github.com/herdrdev/herdr/blob/v0.9.5/src/api/server.rs).

## Recognize the failure

`systemctl --user is-active herdr-server.service` can report `active` while
`herdr api snapshot` fails. A panic in the API accept thread drops its listener
without terminating the main process; `Restart=on-failure` does not help then.
An existing socket file alone does not prove there is a listening server.

Check the actual service, not a guessed PID:

```sh
systemctl --user show herdr-server.service -p MainPID -p ControlGroup -p TasksCurrent -p TasksMax -p MemoryCurrent
journalctl --user -u herdr-server.service --since '1 hour ago'
ss -xlpn
herdr api snapshot
```

For the reported ControlGroup, inspect `/sys/fs/cgroup/CONTROLGROUP/pids.events`,
`pids.current`, `pids.max`, and `cgroup.procs`. `pids.events` with nonzero `max`
proves allocation denials. Count process threads from `/proc/PID/status`;
systemd Tasks counts **threads**, not just processes. Inspect ancestors and
native session state before calling any process abandoned. Do not dump
command lines or environment values into diagnostics: they can contain keys.

The October 17 incident had roughly 639 processes and 9,376 threads, with no
zombies. Many remained attached to live pane/agent owners. Two memory MCP
processes used 319 threads each, including 144 Tokio workers each. Herdr itself
used 226 threads. This establishes oversized thread pools and resource
exhaustion, not a blanket claim that every completed sub-agent leaks.
Herdr 0.8.0 already terminates a closed pane's session processes. A detached
process or idle persistent agent requires separate ownership evidence before
cleanup; never kill all MCPs or all children of systemd.

## Prevent CPU-sized pools in every agent

Relay now supplies bounded pool defaults through the shared launch environment,
including provider swaps, for libraries that honor these variables. Existing
processes retain their original pools. Trusted profile `environment` mappings
can override individual defaults. External DSH hosts and shared Codex daemons
must also receive the limits in their own service environment; Relay cannot
change an already-running host's environment.

For Herdr-owned shells, install the optional service drop-in after reviewing
existing environment overrides:

```sh
mkdir -p ~/.config/systemd/user/herdr-server.service.d
cp deploy/herdr-resources.conf ~/.config/systemd/user/herdr-server.service.d/relay-resources.conf
systemctl --user daemon-reload
```

This does **not** restart Herdr. It applies on its next start. Keep finite PID
limits and inspect parent slice limits before changing them. Raising TasksMax
does not repair a dead listener. Some runtimes, including explicit ONNX
session pools, need their own application-level configuration; these variables
are not a universal cap on all threads or on the number of active sessions.

## Recover existing sessions deliberately

1. Save a private copy of Herdr's config/session state (including named
   sessions), the current binary, unit and overrides. Inventory native session
   IDs and directories. Saved sessions preserve conversation identity, but do
   not checkpoint an in-flight tool or guarantee every background job resumes.
2. Download an official release and compare its SHA-256 with GitHub's release
   asset digest. Test the binary with an isolated XDG_CONFIG_HOME and separate
   socket paths. Exercise Relay's `session.snapshot`/`agent.list` calls before
   replacing the installed binary.
3. If the API still works, investigate supported live handoff first. **When the
   API listener is already dead, API-based handoff cannot be requested.** Do
   not pretend an update restored the listener without checking it.
4. Schedule one service restart with the operator: the default
   `KillMode=control-group` terminates every process in this service, including
   active agents, MCPs, dev servers, and possibly the recovery agent itself.
   Run the approved recovery from an independent user service, not a child
   process that will be killed during restart. Keep backups and avoid automatic
   rollback loops that repeatedly terminate newly restored agents.
5. Verify `ping`, `session.snapshot`, Relay discovery, process/thread counts,
   resume identity and cgroup events after restart. Reopen the client and check
   the current project. Don't resend uncertain messages or automatically
   answer outstanding permissions as part of recovery.

## Verified regression check

On October 17, isolated transient systemd services were started with separate
config/socket paths and `TOKIO_WORKER_THREADS=2`. After a successful ping,
their TasksMax was temporarily lowered below their existing task count, making
the next API worker allocation fail. The limit was then restored:

| Binary | Before | During exhaustion | After restoring headroom |
| --- | --- | --- | --- |
| 0.8.0 | pong | connection reset | connection refused; listener dead |
| 0.9.5 | pong | connection reset | pong; same server PID |

Both disposable services were stopped afterward; production panes were untouched.
