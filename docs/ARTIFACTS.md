# Generated artifacts

A harness can run any authorized Content Studio, ComfyUI, or other generation workflow, save its output, and publish the resulting file to its exact Relay conversation. Relay stores the bytes and a durable `artifact.created` event. Phone disconnects do not lose the output. PNG, JPEG, GIF and WebP render as image cards with a larger preview and downloads; other formats download as files. HTML/SVG are never executed as same-origin pages. File size is limited to 20 MB and shared upload storage to 1 GB.

This delivers artifacts, not a generative OpenUI runtime. OpenUI currently supplies composer controls. Running generated interactive HTML, editing images, annotation, pipeline job controls, and automatically discovering every pipeline output remain unsupported. Generation stays with the harness and its existing tools; no Content Studio or Comfy endpoint is hardcoded or inferred from model text.

## Publish from a harness or pipeline

On Fred the installed helper is `relay-artifact`. Elsewhere, run `node --import tsx scripts/publish-artifact.ts` in the checkout. The helper requires Node, curl, and access to Relay. It reads Fred's configured tailnet URL or an explicit `RELAY_URL`. Tailnet device authentication is used normally; outside it, provide an existing paired device's curl cookie jar via `RELAY_COOKIE_FILE`. Secrets must not appear in command arguments or committed files.

```sh
relay-artifact --session EXACT_RELAY_OR_NATIVE_SESSION_ID \
  --file /path/to/generated.png --title 'Generated concept' \
  --caption 'First variation from the requested pipeline.'
```

Use `--host HOST_ID` if a native session ID exists on multiple hosts. The helper can use `CODEX_THREAD_ID` when available; other harnesses should supply their exact session ID. It never guesses by working directory. `GET /api/sessions` exposes authorized session IDs. Use an exact Relay ID for deterministic targeting.

For remote pipeline hosts:

```sh
RELAY_URL=https://fred.taile5e8a3.ts.net:11543 \
  node --import tsx scripts/publish-artifact.ts \
  --session EXACT_SESSION_ID --file /pipeline/output/result.png
```

The helper resolves matching Tailscale DNS names using local Tailscale status when available. `RELAY_RESOLVE=HOST:PORT:TAILSCALE_IP` explicitly overrides DNS while retaining TLS certificate validation. It checks file size, resolves the current session generation, and uses a deterministic request ID from the session, content, and labels. Retrying unchanged arguments returns the original card. Use a new `--request-id UUID` only when deliberately publishing a second copy.

A Comfy or Content Studio tool should call this helper after it has downloaded a completed job's output. The helper does not submit a generation job or send a new agent message. No changes are required to Herdr supervision or native sessions.

## API

`POST /api/sessions/:id/artifacts?requestId=UUID&generation=OWNER_GENERATION&name=filename&mime=image/png&title=Title&caption=Text`

Body: raw file bytes. Headers: `Content-Type: application/octet-stream`, `X-RC-Request: 1`. Requires authenticated control permission for that session. Replaced owners, conflicting retries, oversized files, unsafe filenames and unauthorized publishers are rejected. Files are downloaded through the existing session-authorized attachment route. The gateway neither reads a caller-specified filesystem path nor fetches a supplied URL.

Publication works independently of `attachFiles`, which describes inbound harness support. An observed session can receive output artifacts from an authorized publisher without falsely advertising native file input. The event, file reference, request identity and audit record survive restart; published attachments cannot be deleted as unused drafts.

Fred validation: the installed `relay-artifact` command published a PNG into the isolated DSH validation conversation through the tailnet endpoint. Repeating the same command returned the same event ID. This verifies publication independently of DSH's unsupported inbound attachments; no generation pipeline was invoked for this fixture.
