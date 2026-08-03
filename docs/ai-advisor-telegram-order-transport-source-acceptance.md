# Telegram order transport source acceptance

Date: 2026-08-03
Status: historical isolated transport acceptance passed; the current five-button customer source remains disabled and needs its own canary acceptance

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
- `telegram-order-action-sink.mjs` implements verified-binding private
  notification settings without manager routing or order-history disclosure.
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
- Historical isolated live acceptance: PASS on 2026-08-02. The process-scoped test harness
  connected to the restricted Aiven Valkey service over TLS, sent one fixed
  six-button menu to an operator-started private test-bot chat, and passed
  signed/unauthorized webhook handling, duplicate protection, distributed rate
  limiting, durable outbox delivery and verified Redis cleanup.
- The live run made zero SalesDrive requests, performed no free-text order
  lookup and used no AI. `TELEGRAM_ORDER_ENABLED` remained false; the URI,
  token and chat ID were neither printed nor persisted.
- The current source intentionally retires the manager button and exposes a
  five-button customer menu. It has no live acceptance yet; activation still
  requires a separately authorized isolated canary for that exact source.

## Remaining live prerequisites

1. Implement and accept the protected SYSTEM-process secret loader described in
   the production activation runbook; plaintext `.env`, task arguments and
   persistent plaintext environment variables are not approved.
2. Configure production-only Telegram credentials and webhook secret through
   that explicitly authorized server-side secret path.
3. Run any separately authorized SalesDrive acceptance without customer/order
   payload disclosure; this was outside the isolated transport run.
4. Enable and register the webhook only after the remaining production
   configuration and acceptance gates pass.

Canonical production sequence and rollback:
[docs/ai-advisor-telegram-production-activation-runbook.md](./ai-advisor-telegram-production-activation-runbook.md).

## Isolated test-bot acceptance

Run `npm run telegram:test-bot:preflight` first. The preflight reports only
missing or invalid variable names and never prints values. Live acceptance
requires process-scoped `VALKEY_AIVEN_TEST_URL` (`rediss://` only),
`TELEGRAM_TEST_BOT_TOKEN`, and `TELEGRAM_TEST_CHAT_ID`, then runs with
`npm run telegram:test-bot:smoke`.

The smoke refuses to run when `TELEGRAM_ORDER_ENABLED=true`. It uses a unique
`aiadvisor:accept:telegram:*` Valkey namespace, checks signed/unauthorized and
duplicate webhook handling, distributed rate limiting, durable outbox delivery,
On the 2026-08-02 historical run it sent the then-current six-button menu.
The current source sends the five-button customer menu and must pass the same
isolated acceptance again before any activation decision. The order adapter is
a deny-by-construction stub: no SalesDrive request or customer/order payload
is possible. All known acceptance keys are deleted and verified absent before
exit; credentials, URI and chat ID are never emitted.

Live result on 2026-08-02:

```json
{"status":"PASS","mode":"live-isolated","tlsValkey":"PASS","telegramMenuTransport":"PASS","signedWebhook":"PASS","unauthorizedWebhook":"PASS","duplicateProtection":"PASS","distributedRateLimit":"PASS","outboxDelivery":"PASS","redisCleanup":"PASS","salesdriveRequests":0,"productionEnabled":false,"freeTextOrderLookup":false,"aiUsed":false,"secretValuesPrinted":false}
```

Provisioning acceptance:
[docs/ai-advisor-telegram-order-provisioning-source-acceptance.md](./ai-advisor-telegram-order-provisioning-source-acceptance.md).
C30/action acceptance:
[docs/ai-advisor-telegram-order-actions-source-acceptance.md](./ai-advisor-telegram-order-actions-source-acceptance.md).
