# C22–C25 — Telegram order status source acceptance

Date: 2026-07-29
Status: source/runtime code synchronized and disabled; config/live activation pending

## Implemented boundary

- `order-dto.mjs` projects a SalesDrive order to a frozen, bounded public DTO.
- `salesdrive-order-client.mjs` uses only `GET /api/order/list/`, an exact
  server-side order-ID range and `limit=2`.
- The client requires a valid C20 proof and C21 Telegram binding before the
  request, then checks `primaryContact.counterpartyId` or
  `contacts[].counterpartyId` against the bound customer before DTO projection.
- `telegram-order-menu.mjs` accepts only six fixed callbacks in the bound private
  chat, renders deterministic RU/UK responses and includes a per-user source
  rate limiter.
- Free text, prompt construction, model context, OpenAI calls and AI-generated
  order responses do not exist in this contour.

The endpoint is confirmed by the official
[SalesDrive API documentation](https://api.salesdrive.me/api/docs/). The source
package contains no API key, real host, request capture or customer/order fixture.

## Public DTO allow-list

- public order reference;
- created/updated time;
- normalized order status label;
- payment state, safe method label, total/paid/remaining amounts and currency;
- safe delivery method/carrier, city, branch, tracking number and confirmed date;
- at most 20 product lines with bounded name, SKU, quantity and unit price;
- source, fetch time and freshness marker.

The DTO excludes customer identity and contacts, exact address, payment
credentials, CRM comments, manager/marketing fields, print tokens, internal
order/contact/counterparty/product/warehouse/delivery refs, and cost,
commission, expense or profit fields.

## Fail-closed behavior

- Missing/malformed/expired/replayed proof or invalid Telegram binding causes no
  order request.
- Invalid source ID, no result, duplicate result and ownership mismatch expose
  the same public `ORDER_NOT_AVAILABLE` result.
- Host is restricted to a valid `*.salesdrive.me` subdomain, redirects are
  rejected, timeout and transport failures are neutral, and errors do not echo
  upstream payloads or credentials.
- Unsupported text/callbacks, group chats and a mismatched Telegram identity
  only show the menu and perform no data read.
- The original in-memory limiter is retained for isolated menu tests. C26–C29
  add a Redis-atomic distributed limiter and webhook orchestration.

## Verification

- Focused C22–C25: 22/22 PASS.
- Full source suite after C30/outbox: 182/182 PASS.
- Tests use injected synthetic data and an injected fetch implementation only.
- No Telegram, SalesDrive, OpenCart or ERP request was made.
- Disabled runtime acceptance: source/runtime diff 0, local/public health HTTP
  200 and local/public order-link HTTP 404.

## Deferred live activation

The disabled-by-default server wiring now includes webhook/provisioning,
Redis-backed one-time state, opaque selection, distributed limiting, C30 manager
and notification actions, and a durable at-least-once outbox. Live activation
still requires approved Redis/bot/webhook/manager configuration, test-bot and
Redis failover acceptance, authorized synthetic SalesDrive acceptance and
secret-safe runtime verification.

C26–C29 and transport acceptance:
[docs/ai-advisor-telegram-order-webhook-source-acceptance.md](./ai-advisor-telegram-order-webhook-source-acceptance.md).
[docs/ai-advisor-telegram-order-transport-source-acceptance.md](./ai-advisor-telegram-order-transport-source-acceptance.md).
[docs/ai-advisor-telegram-order-provisioning-source-acceptance.md](./ai-advisor-telegram-order-provisioning-source-acceptance.md).
[docs/ai-advisor-telegram-order-actions-source-acceptance.md](./ai-advisor-telegram-order-actions-source-acceptance.md).
