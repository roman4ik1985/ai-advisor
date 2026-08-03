# HANDOFF — Telegram production readiness

## Goal

Continue from the customer self-service Telegram readiness verdict without activating Telegram until every separately protected gate is explicitly approved.

## Done

- Free Aiven Valkey `ai-advisor-valkey` remains on Free-1, TLS-protected, and restricted to the Windows runtime host `/32`; open IPv4/IPv6 ranges are absent. The secret-safe TLS smoke passed twice.
- The `TelegramCustomerRuntime` release profile is applied. Its repeat dry-run is zero; local `/health`, local `/ready`, and public `/health` are HTTP 200; the disabled Telegram webhook route returns HTTP 404.
- The isolated Telegram test-bot preflight was READY and its live smoke passed: TLS Valkey, six-button menu transport, signed and unauthorized webhook behavior, duplicate protection, distributed rate limit, durable outbox delivery, and Redis cleanup. SalesDrive requests, free-text lookup, and AI use were all zero.
- Customer self-service source removes manager-chat routing and the manager-chat-ID bundle dependency. Telegram remains ownership-gated, menu-only, and AI-free.
- The canonical production activation/rollback runbook is present. At this verdict, `main` equals `origin/main` at `2f7b37c217be538adeb3a4b3b6ce45c854f74ae6`.

## Current Constraints

- Keep `TELEGRAM_ORDER_ENABLED=false`. Telegram is disabled, menu-only, and AI-free; anonymous or free-text order lookup is prohibited.
- Do not read, print, persist, or place secrets in `.env`. Do not inspect cookies or browser storage.
- Do not touch SalesDrive customer/order payloads, OpenCart/cPanel, Tunnel, DNS, Aiven plan, or unrelated runtime.
- The protected SYSTEM loader exists, but production Telegram configuration is not provisioned or enabled. Do not solve this with task XML or plaintext environment variables.
- The dirty/untracked baseline predating this handoff is user-owned and must stay byte-for-byte untouched.

## Next Steps

1. **must-have:** keep the released customer runtime disabled unless a separate authorization covers protected configuration provisioning and a disabled-first preflight.
2. **must-have after that authorization:** run boolean/code-only production preflight. Separately authorize any SalesDrive acceptance that would access real customer/order data.
3. **only after all gates pass:** obtain explicit authorization for Telegram `setWebhook`, make the bounded HTTPS webhook change, run a fixed menu-only canary, and retain the disable-first rollback path.

## Key Files

- `C:\AI Advisor\docs\ai-advisor-telegram-production-activation-runbook.md`
- `C:\AI Advisor\docs\ai-advisor-telegram-order-transport-source-acceptance.md`
- `C:\AI Advisor\docs\ai-advisor-valkey-aiven-readiness.md`
- `C:\AI Advisor\scripts\validate-telegram-test-bot.mjs`
- `C:\AI Advisor\scripts\release-active-runtime.ps1`
- `C:\AI Advisor\AGENTS.md`
- `C:\AI Advisor\wiki\log.md`

## Savepoint Notes

- This handoff is the local savepoint commit containing this file; it intentionally does not publish it.
- Start the next slice with `git status --short` and `.\scripts\agent-os.ps1 task status`, then create a new bounded Agent OS task.
- Preserve the existing user-owned dirty/untracked baseline; stage only files in the new task's explicit allowed scope.
