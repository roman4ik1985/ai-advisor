# C26–C29 — Telegram order webhook and durable-state source acceptance

Date: 2026-07-29
Status: source transport wired; configuration, provisioning and active release remain disabled

## Implemented

- `telegram-order-webhook.mjs` authenticates the Telegram secret header, claims
  every `update_id` once and accepts only a private `/start <opaque-token>`, the
  current user's `request_contact`, six allow-listed menu callbacks and contextual
  opaque order-selection callbacks.
- `telegram-order-redis-store.mjs` defines a Redis-backed durable state adapter
  for expiring link sessions, pending chats, phone-free bindings, update dedupe,
  single-use order choices, active selection and single-use lookup grants.
- Link completion atomically deletes the link/pending state and writes the
  binding. Selection and proof tokens use Redis `SET NX PX` and `GETDEL`.
- The phone exists only in the expiring pre-binding link record and is deleted
  when the phone-free binding is committed.
- `telegram-order-redis-rate-limit.mjs` uses one atomic Redis Lua operation per
  Telegram user and fails closed when Redis is unavailable.
- The webhook orchestrator returns bounded transport commands; it does not call
  Telegram, SalesDrive, OpenCart, ERP, Redis or OpenAI by itself.

## Deterministic flow

1. A valid secret header and new `update_id` are mandatory.
2. `/start <token>` associates the private Telegram user with an unexpired link.
3. Own `request_contact` completes the existing C21 verification and atomically
   writes `telegramUserId → customerRef`.
4. `📦 Мої замовлення` invokes only the injected owned-order listing operation.
5. Each displayed order receives a 32-character opaque, ten-minute,
   single-use selection callback; source ID and order reference are absent from
   callback data.
6. Selection stores one active order for 30 minutes.
7. Status/payment/delivery creates and atomically consumes a C20-compatible
   lookup grant, then calls the injected C23 service.
8. Responses use the existing deterministic menu templates. Free text only
   returns the menu after binding and never reads order data.

## Security acceptance

- Wrong secret: HTTP 401 and no action.
- Duplicate update: HTTP 200 and no action.
- Group chat, cross-user selection, replay, malformed state, missing selection,
  expired/missing link, Redis error and rate-limit excess fail closed.
- Server-side proof contains no order locator. Order linkage stays inside the
  one-time Redis grant.
- No AI/model/prompt, SQL, outbound Telegram request, secret logging or raw
  customer/order fixture exists in this package.

## Verification

- Focused C26–C29: 15/15 PASS.
- Full source suite: 155/155 PASS.
- All Redis, order and Telegram boundaries are injected synthetic adapters.
- No active server/runtime file, `.env`, secret or external system was accessed
  or changed.

## Still required for release

- Configure an approved Redis namespace and credentials.
- Implement authenticated order-link provisioning.
- Add dictionary hydration.
- Implement actual notification settings and manager delivery.
- Run isolated Redis concurrency/failover acceptance, Telegram test-bot
  acceptance, authorized synthetic SalesDrive acceptance, log review and
  source/runtime release checks.

Transport acceptance:
[docs/ai-advisor-telegram-order-transport-source-acceptance.md](./ai-advisor-telegram-order-transport-source-acceptance.md).
