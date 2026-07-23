# AI Advisor — production-ready savepoint (2026-07-23)

## HANDOFF

### Goal

- Run the AI Advisor backend locally from `F:\Services\AI Advisor` as a boot-safe, externally reachable production service for the existing LedProjector storefront.

### Done

- API hardening is complete: bounded concurrency/queue, fixed-window rate limit, `Retry-After`, `{ error, code, requestId }`, rate-bucket cleanup and graceful shutdown.
- The active API runs as `AI Advisor API Host` under `SYSTEM`; `Cloudflared` is an automatic Windows service; `AI Advisor Health Monitor` runs under `SYSTEM` every minute.
- Permanent public endpoint: `https://ai.ledprojector.com.ua`; local endpoint: `http://127.0.0.1:8788/health`.
- Better Stack monitor `4715620` checks `/health` every three minutes. Its controlled temporary-404 smoke reached `Down` then `Up` without interrupting the Tunnel or storefront.
- Runtime logs rotate at 10 MB and keep only 14-day AI Advisor archives. The deployed SYSTEM monitor executed the helper successfully.
- Live no-cost rate-limit smoke proved `429 RATE_LIMITED`, `Retry-After`, request-id parity and bucket reset. The isolated HTTP test provider proved `1 active + 1 queued + 1 rejected` → `503 AI_QUEUE_FULL` without OpenAI or catalog calls.
- Source C: and active F: runtime files were mirrored and verified. `npm test` passes 27/27 in both copies; current local/public health is 200.

### Current Constraints

- Active runtime: `F:\Services\AI Advisor`; `C:\AI Advisor` is the source/rollback copy.
- No `OPENAI_API_KEY` or other secret may enter browser code, public assets, cPanel or handoff files.
- Automated backup is explicitly deferred by the user; do not create a backup task or choose a destination without renewed approval.
- `AI_PROVIDER=test` is allowed only with `NODE_ENV=test` and is rejected in production.
- Better Stack Free notifies the team rather than an on-call schedule. Its UI `Send test alert` route returned 404; use the documented temporary-404 smoke for alert-path verification. Receipt in the intended team mailbox remains unconfirmed.
- Workspace is not a Git repository; this savepoint is documented, not committed.

### Next Steps

1. No remaining API production must-have. If requested, verify Better Stack mail delivery in the actual team mailbox without changing infrastructure.
2. Only with explicit approval: add an off-runtime automated backup and restore smoke.
3. Keep knowledge updates as a separate editorial slice using `npm run knowledge:find`, `npm run knowledge:upsert` and `npm run check:knowledge`.

### Key Files

- `C:\AI Advisor\AGENTS.md`
- `C:\AI Advisor\PROJECT_LOG.md`
- `C:\AI Advisor\README.md`
- `C:\AI Advisor\HANDOFF_2026-07-23.md`
- `C:\AI Advisor\scripts\monitor-local-host.ps1`
- `C:\AI Advisor\scripts\rotate-runtime-logs.ps1`
- `C:\AI Advisor\test\http-backpressure.test.mjs`
- `F:\Services\AI Advisor\README.md`

### Savepoint Notes

- Savepoint time: 2026-07-23 18:23 Europe/Kiev.
- Git status is unavailable because this workspace is not a Git repository.
- Do not reopen legacy cPanel/Cloudflare browser work unless a new production change is explicitly requested.
