# HANDOFF — Telegram production readiness

## Goal

Continue from the completed isolated Telegram test-bot acceptance toward a production-readiness decision, without activating Telegram until every separately protected gate is explicitly approved.

## Done

- Free Aiven Valkey `ai-advisor-valkey` remains on Free-1, TLS-protected, and restricted to the Windows runtime host `/32`; open IPv4/IPv6 ranges are absent. The secret-safe TLS smoke passed twice.
- The exact nine-file P3/P4 runtime release is applied. Its repeat dry-run is zero, runtime-owned widget configuration remains enabled, and local/public health are HTTP 200.
- The isolated Telegram test-bot preflight was READY and its live smoke passed: TLS Valkey, six-button menu transport, signed and unauthorized webhook behavior, duplicate protection, distributed rate limit, durable outbox delivery, and Redis cleanup. SalesDrive requests, free-text lookup, and AI use were all zero.
- Agent OS verification timeout now has a bounded 120-second default; Pester passed 20/20 and `frontend-fast` passed with the full source suite at 220/220.
- The canonical production activation/rollback runbook is present. Before this handoff, `main` and `origin/main` both resolved to `1f5d328bf15d07848d08bb1b66b6a1c6966291f5`.

## Current Constraints

- Keep `TELEGRAM_ORDER_ENABLED=false`. Telegram is disabled, menu-only, and AI-free; anonymous or free-text order lookup is prohibited.
- Do not read, print, persist, or place secrets in `.env`. Do not inspect cookies or browser storage.
- Do not touch SalesDrive customer/order payloads, OpenCart/cPanel, Tunnel, DNS, Aiven plan, or unrelated runtime.
- A production SYSTEM task has no approved protected secret loader. Do not solve this with task XML or plaintext environment variables.
- The dirty/untracked baseline predating this handoff is user-owned and must stay byte-for-byte untouched.

## Next Steps

1. **must-have:** obtain a separate explicit authorization for a narrowly scoped protected SYSTEM secret-loader design/implementation, or decide not to activate production Telegram.
2. **must-have after the loader is approved:** run boolean/code-only production preflight. Separately authorize any SalesDrive acceptance that would access real customer/order data.
3. **only after all gates pass:** obtain explicit authorization for Telegram `setWebhook`, make the bounded HTTPS webhook change, run a fixed menu-only canary, and retain the disable-first rollback path.

## Key Files

- `C:\AI Advisor\docs\ai-advisor-telegram-production-activation-runbook.md`
- `C:\AI Advisor\docs\ai-advisor-telegram-order-transport-source-acceptance.md`
- `C:\AI Advisor\docs\ai-advisor-valkey-aiven-readiness.md`
- `C:\AI Advisor\scripts\validate-telegram-test-bot.mjs`
- `C:\AI Advisor\scripts\release-active-runtime.ps1`
- `C:\AI Advisor\AGENTS.md`
- `C:\AI Advisor\PROJECT_LOG.md`

## Savepoint Notes

- This handoff is the local savepoint commit containing this file; it intentionally does not publish it.
- Start the next slice with `git status --short` and `.\scripts\agent-os.ps1 task status`, then create a new bounded Agent OS task.
- Preserve the existing user-owned dirty/untracked baseline; stage only files in the new task's explicit allowed scope.
