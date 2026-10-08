# DSH native integration status

DSH is **not yet an enabled Relay harness**. The native Typert client in `packages/adapters/src/dsh.ts` implements authenticated session enumeration, model catalog reads, exact provider/model selection and prompt admission with explicit `steer`/`queue` mode and caller-owned request IDs. It does not launch an extra host or create another session writer. Its contract tests run against an isolated HTTP fixture.

The protocol was checked against Fred's installed source in `deepseek-harness/packages/api/session-controller` and `packages/client/connection`: POST `/api/session/<method>`, client-request/server-response envelopes, correlated rpcId, and named payload args. DSH's source is MIT licensed; no DSH implementation was copied into Relay. The transport requires the existing host's authenticated cookie, obtained by an authorized native login. Redirects are refused to avoid forwarding credentials; remote endpoints require HTTPS. Cookies are retrieved through a callback and never logged or persisted by this client.

## Deployment blockers on Fred

- Port 3080 is owned by the existing system `dsh-web.service`, while the older user `dsh-w6800.service` repeatedly attempts to bind the same port. Relay has not stopped either service or replaced the active host.
- The active host returns HTTP 401 without its authentication. The old bootstrap token file `/run/user/1000/dsh-w6800/token` is absent; no DSH credential is registered in the shared agent keychain. No existing credential was overwritten or synthesized.
- Existing DSH sessions need authoritative mapping to their Herdr process, or an explicitly represented externally supervised native host. Session title and CWD are insufficient proof of ownership. No write capability is advertised until that mapping and authenticated host access work.

## Remaining implementation

After authenticated access is available, implement native history/follow normalization (including compact assistant streams and replacement semantics), discovery/ownership validation, exact pending interactions, and expose the native model catalog in the launch/settings UI. Verify a harmless isolated session through Send, Steer and model selection before enabling DSH controls. Transport tests alone do not establish live support.
