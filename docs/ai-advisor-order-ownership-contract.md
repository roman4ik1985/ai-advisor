# C20 — ownership/auth contract for order status

Date: 2026-07-29
Status: C20–C29 source contracts implemented; active bot/runtime integration remains disabled

## Scope

C20 defines the proof boundary before personal order lookup. C21 implements the
source-only Telegram contact-binding contract. C22–C25 add the bounded order DTO,
GET-only injected SalesDrive adapter, fixed menu/templates and synthetic security
acceptance. None of these modules is connected to Telegram, SalesDrive, OpenCart
or ERP runtime, reads a real order, adds a webhook, persists a binding, or changes
the active runtime.

The executable source contract is `order-ownership-contract.mjs`. It accepts only
an opaque server-produced proof envelope and returns an authorization gate. It
does not accept an order number, order-existence flag, contact detail, status, or
other order data.

## Selected store flow

This is an ordinary menu-only retail-order flow:

1. The web assistant creates a ten-minute opaque deep-link session and displays
   `Перевірити замовлення в Telegram`.
2. The customer opens a private bot chat from that link.
3. The bot requests the current user's phone through Telegram `request_contact`.
4. Backend accepts only a private chat where `chat.id`, `from.id` and
   `contact.user_id` identify the same Telegram user.
5. The normalized shared phone must match the phone already held for the selected
   customer/order.
6. Backend atomically consumes the link session and stores only the resulting
   `telegramUserId → customerRef` binding. The phone is not part of the binding DTO.
7. Subsequent order actions are available only through the six fixed menu buttons.

Typed phone text, forwarded contacts, group chats, reused/expired links and
mismatched Telegram identities are rejected. There is no free-text order input,
intent recognition or AI/model call in this flow.

## Fail-closed decision

Order lookup is denied unless every condition below is true:

1. Contract version and purpose match `1.2` and `ORDER_STATUS`.
2. Proof state is `VERIFIED`.
3. The opaque proof-session identifier is valid.
4. A private Telegram customer binding is verified.
5. Backend confirms that the requested order belongs to that bound customer.
6. The proof has valid timestamps, is not expired, and its lifetime is at most
   ten minutes.
7. The proof has not been consumed.

An allowed decision authorizes only the next lookup gate and requires atomic
single-use consumption before a future order request. It is not order evidence.

## Anti-enumeration contract

- Missing, malformed, denied, locked, expired, replayed, or wrongly bound proofs
  produce the same public denial code and localized neutral message.
- The response must not reveal whether an order, phone number, email, or other
  locator exists.
- A future challenge request must keep equivalent public status/body shape and
  timing for existing and non-existing locators.
- A basic rate limit applies per visitor, link session and bound Telegram user.
- Proof secrets, channel destinations, raw identifiers, and rejection reasons
  must not enter browser-visible data, model context, analytics, or ordinary logs.

## User-visible order data after proof

After a successful Telegram binding and ownership proof the bot may show the ordinary order details the
customer expects: full order number, product names and quantities, total and
currency, normalized order/payment/fulfillment status, delivery method, tracking
number/link, confirmed delivery date, and last update time.

The response still excludes full phone/email/address, payment-card or transaction
credentials, CRM notes, cost/margin fields, internal identifiers, and other
orders. Raw SalesDrive payloads are projected to this allow-list before reaching
the Telegram renderer. The order contour has no model boundary at all.

C21 source validation is implemented in `telegram-order-binding.mjs`. C26–C29
add secret-authenticated injected webhook orchestration, Redis-backed persistent
binding/proof/selection state and distributed limiting. HTTP route, Redis client,
Telegram sender and active runtime integration are still pending.
C22–C25 source validation is implemented in `order-dto.mjs`,
`salesdrive-order-client.mjs`, `telegram-order-menu.mjs` and their tests.
Anonymous lookup remains forbidden; runtime lookup remains disabled.

## Verification

`test/order-ownership-contract.test.mjs` covers the final lookup gate, Telegram
binding, backend ownership, expiry, replay and neutral public results.
`test/telegram-order-binding.test.mjs` covers deep-link entropy/expiry, private
own-contact validation, Ukrainian phone normalization, typed/forwarded contact
rejection, group/mismatched identity rejection, phone-free binding projection
and neutral public failures. The C22–C25 suites cover bounded projection,
ownership-first GET access, callback-only routing, deterministic RU/UK templates,
per-user rate limiting, PII exclusion and absence of AI/write methods.

No existing endpoint, request field, response field, or HTTP status changes in
C20. The current client contract is therefore backward-compatible and unchanged.
The focused C26–C29 suites pass 15/15 and the full source suite passes 155/155.

Detailed source acceptance:
[docs/ai-advisor-order-status-source-acceptance.md](./ai-advisor-order-status-source-acceptance.md).
[docs/ai-advisor-telegram-order-webhook-source-acceptance.md](./ai-advisor-telegram-order-webhook-source-acceptance.md).
