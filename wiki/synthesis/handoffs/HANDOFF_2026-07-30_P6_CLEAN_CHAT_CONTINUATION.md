# HANDOFF — P6 savepoint / clean continuation

## Goal

Keep the accepted AI Advisor production baseline stable and continue only with an explicitly approved next contour. The currently deferred contour is Telegram order status activation after the owner provisions server-side Telegram and Redis configuration.

## Done

- Direct SalesDrive contour and Agent OS 1.0 are release-ready.
- Telegram order source contour C20–C30 is implemented in source and active runtime, but remains disabled.
- P5 C50–C54 production widget rollout is accepted.
- P6 C60–C64 read-only production monitoring is implemented and committed as `0766df0`:
  - five fixed storefront routes;
  - Lightning bundle normal/cache-busted SHA-256 parity;
  - desktop mount/focus smoke and mobile 390x844 LCP/CLS/INP gate;
  - two real PASS runs, 5/5 routes and mounts, zero browser errors.
- Full P6 verification passed: 213/213 tests, Agent OS scope/park/commit checks PASS.

## Current constraints

- `main` is one commit ahead of `origin/main`: `0766df0`. Push only after an explicit command.
- Preserve user-owned dirty/untracked files exactly: `AGENTS.md`, `.backup-key.dpapi`, `_backups/`, root `agent-os.ps1`, Agent OS docs/PDF/backup and restore scripts, and `modules/AgentOS/Private/Scope.ps1.bak`.
- Do not touch `F:\Services\AI Advisor`, `.env`, secrets, Telegram/Redis, SalesDrive customer/order payloads, OpenCart/cPanel, Tunnel or remote without a new explicit authorization.
- Anonymous order lookup and free-text Telegram order handling are prohibited. Telegram remains menu-only and AI-free.
- Feature flag remains `TELEGRAM_ORDER_ENABLED=false` until credentials, test-bot, Redis failover and authorized synthetic SalesDrive acceptance all pass.

## Next step

1. Owner provisions Telegram bot username/token, webhook secret, Redis URL and manager chat ID without sharing values in chat.
2. With explicit authorization, run the narrow local configuration/test-bot readiness contour while the feature stays disabled.
3. Only then approve a distinct production release/enablement contour.

## Key files

- `C:\AI Advisor\AGENTS.md`
- `C:\AI Advisor\wiki\log.md`
- `C:\AI Advisor\README.md`
- `C:\AI Advisor\wiki\synthesis\specifications\TECHNICAL_SPECIFICATION.md`
- `C:\AI Advisor\docs\ai-advisor-p6-production-monitoring.md`
- `C:\AI Advisor\docs\ai-advisor-telegram-order-transport-source-acceptance.md`
- `C:\AI Advisor\wiki\synthesis\handoffs\HANDOFF_2026-07-29_SALESDRIVE_LIVE_FINAL.md`

## Savepoint notes

- Canonical Git savepoint: `0766df0` (`feat: add P6 production monitoring gate`).
- Agent OS P6 task completed: `TASK-2026-07-29-140816-215`.
- HSC handoff task: `TASK-2026-07-30-152221-401`.
- At the start of the next slice run `git status --short` and `.\scripts\agent-os.ps1 task status`.
