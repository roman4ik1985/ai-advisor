# C30 — Telegram manager actions and durable outbox acceptance

Date: 2026-07-29
Status: source PASS; code released disabled, configuration absent

## Implemented

- `telegram-order-action-sink.mjs` handles only two internal operations:
  `REQUEST_MANAGER` and `OPEN_NOTIFICATION_SETTINGS`.
- Manager handoff sends a bounded contact request containing only the internal
  customer reference. It contains no order, phone, address, conversation or
  payment data and confirms delivery only in the same private customer chat.
- Notification settings are an atomic Redis toggle bound to the verified
  Telegram user and customer reference.
- `telegram-order-outbox.mjs` atomically deduplicates deterministic delivery
  IDs, persists allow-listed actions, claims them with a visibility timeout,
  retries failures and retains terminal dead letters for seven days.
- Runtime acknowledges a Telegram update only after every resulting action is
  durably enqueued. A bounded background drain resumes pending work after
  process restart.

## Delivery semantics

The outbox provides durable at-least-once delivery and enqueue deduplication.
Telegram Bot API does not provide an idempotency key for `sendMessage`, so an
ambiguous network failure after Telegram accepted a message can still produce
a duplicate on retry. The implementation does not claim impossible
exactly-once external delivery.

## Server-side configuration

- `TELEGRAM_ORDER_MANAGER_CHAT_ID`
- existing `TELEGRAM_ORDER_BOT_TOKEN`
- existing `TELEGRAM_ORDER_WEBHOOK_SECRET`
- existing `TELEGRAM_ORDER_REDIS_URL`

All values stay server-side. Missing required values stop startup only when
`TELEGRAM_ORDER_ENABLED=true`.

## Verification

- Focused action/outbox/runtime tests: 11/11 PASS.
- Full source suite: 182/182 PASS.
- Tests cover enqueue deduplication, visibility retry, dead-letter boundary,
  Redis failure, action allow-listing, manager disclosure boundary,
  notification persistence and enqueue-before-ack runtime behavior.
- No AI/model/prompt dependency exists in the action or outbox path.
- No Telegram, Redis or SalesDrive network request and no real customer/order
  payload was used.

## Disabled runtime release

The hash-verified source-to-runtime release copied 61 accumulated tracked files
from the accepted C10–C30 source baseline. The SYSTEM API host restarted from
PID 29552 to PID 39316. Source/runtime release diff is zero; local and public
`/health` return HTTP 200. Local and public `/api/telegram/order-link` return
HTTP 404 because `TELEGRAM_ORDER_ENABLED` remains false.

## Live readiness

Both source and active-runtime `.env` lack the required Telegram/Redis
configuration as of this acceptance. The disabled release is safe; test-bot,
Redis concurrency/failover and authorized synthetic SalesDrive acceptance
remain blocked until operator-provided server-side configuration exists.
