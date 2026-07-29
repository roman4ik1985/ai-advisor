# Telegram order transport source acceptance

Date: 2026-07-29
Status: source and runtime code synchronized; feature disabled, configuration and live activation pending

## Implemented

- Added `redis` 6.1.0 as a locked production dependency.
- `telegram-order-redis-client.mjs` wraps `redis://` / `rediss://`, bounded
  reconnect and explicit connect/close without logging credentials.
- `telegram-order-sender.mjs` allow-lists only `sendMessage` and
  `answerCallbackQuery`, normalizes Telegram keyboard fields, rejects redirects
  and retries the same bounded command up to three times.
- `telegram-owned-order-service.mjs` lists only source-order IDs already stored
  by a verified link session. It does not guess or use an undocumented
  SalesDrive customer-filter; every ID is re-read through the existing exact-ID
  ownership client and one-time proof.
- `telegram-order-runtime.mjs` assembles Redis state, distributed limiting,
  owned-order service, webhook, sender, C30 action sink and durable outbox.
  Resulting actions are persisted before the webhook update is acknowledged.
- `telegram-order-action-sink.mjs` implements bounded manager handoff and
  verified-binding notification settings without order-history disclosure.
- `telegram-order-outbox.mjs` provides Redis enqueue deduplication, visibility
  retry and a bounded dead-letter path with honest at-least-once semantics.
- `server.mjs` contains the fixed
  `POST /api/telegram/order-webhook` route. It exists only when
  `TELEGRAM_ORDER_ENABLED=true`; otherwise the current server behavior is
  unchanged.
- `scripts/release-active-runtime.ps1` now includes all order modules and the
  package lock in a future explicit release.

## Server-side configuration

- `TELEGRAM_ORDER_ENABLED` — false by default.
- `TELEGRAM_ORDER_WEBHOOK_SECRET`
- `TELEGRAM_ORDER_BOT_TOKEN`
- `TELEGRAM_ORDER_REDIS_URL`
- `TELEGRAM_ORDER_MANAGER_CHAT_ID`
- `TELEGRAM_ORDER_RATE_LIMIT_PER_MINUTE` — bounded to 1–60.

Missing required configuration stops startup only when the contour is enabled.
Values are never sent to the browser or added to normal logs.

## Verification

- Focused C30/action/outbox/runtime tests: 11/11 PASS.
- Full source suite: 182/182 PASS.
- `npm audit`: 0 vulnerabilities.
- Existing API/CLI server tests pass with the feature disabled.
- Disabled runtime release: source/runtime diff 0, new PID 39316, local/public
  health HTTP 200 and local/public order-link HTTP 404.
- No Redis connection, Telegram request, SalesDrive order request, `.env` read,
  customer/order payload, active runtime or remote change was performed.

## Remaining live prerequisites

1. Provision an approved Redis namespace and credentials.
2. Create/configure the Telegram bot username, webhook secret and bot token.
3. Configure an approved manager chat.
4. Run concurrency/failover, Telegram test-bot and authorized synthetic
   SalesDrive acceptance.
5. Enable only after the preceding configuration and acceptance gates pass.

Provisioning acceptance:
[docs/ai-advisor-telegram-order-provisioning-source-acceptance.md](./ai-advisor-telegram-order-provisioning-source-acceptance.md).
C30/action acceptance:
[docs/ai-advisor-telegram-order-actions-source-acceptance.md](./ai-advisor-telegram-order-actions-source-acceptance.md).
