# Validation evidence and Fred acceptance

Local inspection found Herdr 0.8.0, protocol 19 and Codex CLI 0.161.0. The installed Herdr schema is checked into test fixtures; mock response contracts are validated with AJV. Installed Codex generates ClientRequest/ServerRequest schemas and the bridge detects supported methods. No real transcript or production agent prompt was read or sent during this build.

Latest local result: **26/26 unit/integration tests and 2/2 browser tests passed**, TypeScript/lint/production build passed, pinned design-skill checks passed, and production npm audit reported zero vulnerabilities.

Run `npm run check` for TypeScript, lint, unit/integration contracts and production assets. Run `npm run test:e2e` after installing Playwright Chromium (or set `CHROMIUM_PATH` to an installed Chrome executable). Tests cover partial UTF-8 transcripts, rotation and symlink escapes; native dedup/redaction; queue CRUD/idempotency/order/recovery/uncertain delivery; exact pending questions/approvals/double submission/expiry/replacement; device authorization/rotation/revocation and WebSocket origin; a genuine Claude hook executable's documented output; and a real Codex bridge process against a credential-free JSON-RPC fixture.

Browser tests pair privately, request native approval, queue two follow-ups, answer the exact card, verify ordered completion, disconnect/reconnect, and inspect settings. They check phone widths 320/375/390/430, landscape, tablet and desktop, 48px targets, no horizontal overflow, text scaling, reduced motion, and axe WCAG 2.1 AA checks in light/dark themes. Screenshots live in `docs/screenshots`. These are browser emulation tests, not physical device or live harness acceptance.

## Executable checks on Fred

```sh
herdr --version
herdr api schema --json
RC_CONFIG=~/.config/relay/config.json npm run diagnose -- --live
curl --fail http://127.0.0.1:4080/health
npm run check
npm run test:e2e
```

Diagnostics print version, available required methods, private socket ownership and counts only. Treat the installed schema as authoritative if Fred differs. No undocumented API is required.

## Manual live acceptance, still unverified

1. Start an ordinary Claude/Codex CLI in Herdr. Pair the phone, verify automatic discovery, correct native ID, ordered structured history, and simultaneous original terminal usability. Send a harmless instruction from the composer and verify it appears in the original native transcript. Queue two follow-ups and verify native completion releases them in order.
2. Install the Claude hook and trigger a real supported tool permission. Verify the exact pending card, allow/deny, original process continuation and terminal fallback when the gateway is unavailable. Generic Claude questions are outside this adapter's supported scope.
3. Launch/register the Codex bridge under Herdr. Submit a real native turn, inspect streaming, trigger requestUserInput or a tool approval, answer its specific card, and verify it continues without a second user turn. Queue two followups while busy and verify serial execution.
4. Disconnect the phone, reconnect, restart only the gateway, and verify no duplicate messages, no repeated task sends, persistent queue and pending interaction state. Replace the native process and verify old controls/tasks cannot target its replacement.
5. Test Android Chrome and iOS Safari/PWA installation, software keyboard, safe areas, focus, text scaling and foreground notifications. Closed-app native push is not implemented.

CLI chat and queue transport is implemented; complete native question/approval parity remains limited as documented in CAPABILITIES.md. Mock-backed Phase 1 and the supported native bridge pathway are executable now; live interactive parity must not be inferred from fixture results.
