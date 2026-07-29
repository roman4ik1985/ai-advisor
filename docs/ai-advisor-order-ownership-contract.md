# C20 — ownership/auth contract for order status

Date: 2026-07-29
Status: source contract implemented; order lookup remains disabled

## Scope

C20 defines the proof boundary that must exist before any personal order lookup.
It does not select or implement a verification channel, call SalesDrive, read an
order, process customer data, add a public endpoint, or change the active runtime.

The executable source contract is `order-ownership-contract.mjs`. It accepts only
an opaque server-produced proof envelope and returns an authorization gate. It
does not accept an order number, order-existence flag, contact detail, status, or
other order data.

## Simplified store policy

This is an ordinary retail-order flow, not high-assurance identity proofing. The
selected C21 mechanism is intentionally simple:

1. The visitor enters the order number.
2. The server sends a six-digit one-time code through Telegram Gateway to the
   phone already stored on that order.
3. A correct code opens one order lookup for ten minutes.
4. The code allows at most five attempts and can be used only once.

No OpenCart-account binding, Telegram Login, Mini App, device fingerprint, second
factor, or manager approval is required for the normal path. If Telegram delivery
is unavailable, the visitor is sent to the existing manager fallback.

## Fail-closed decision

Order lookup is denied unless every condition below is true:

1. Contract version and purpose match `1.1` and `ORDER_STATUS`.
2. Proof state is `VERIFIED`.
3. The opaque proof-session identifier is valid.
4. The Telegram one-time challenge is verified in no more than five attempts.
5. The proof has valid timestamps, is not expired, and its lifetime is at most
   ten minutes.
6. The proof has not been consumed.

An allowed decision authorizes only the next lookup gate and requires atomic
single-use consumption before a future order request. It is not order evidence.

## Anti-enumeration contract

- Missing, malformed, denied, locked, expired, replayed, or wrongly bound proofs
  produce the same public denial code and localized neutral message.
- The response must not reveal whether an order, phone number, email, or other
  locator exists.
- A future challenge request must keep equivalent public status/body shape and
  timing for existing and non-existing locators.
- A basic rate limit applies per visitor and order digest.
- Proof secrets, channel destinations, raw identifiers, and rejection reasons
  must not enter browser-visible data, model context, analytics, or ordinary logs.

## User-visible order data after proof

After a successful code the assistant may show the ordinary order details the
customer expects: full order number, product names and quantities, total and
currency, normalized order/payment/fulfillment status, delivery method, tracking
number/link, confirmed delivery date, and last update time.

The response still excludes full phone/email/address, payment-card or transaction
credentials, CRM notes, cost/margin fields, internal identifiers, and other
orders. Raw SalesDrive payloads are projected to this allow-list before reaching
the browser or model.

C21 now has an owner-selected mechanism, but its Telegram/API implementation is
still pending. C22–C25 also remain unimplemented. Anonymous lookup remains
forbidden.

## Verification

`test/order-ownership-contract.test.mjs` covers the valid gate plus missing proof,
all non-verified states, missing challenge proof, attempt limit, expiry, clock skew, excessive TTL,
replay, invalid opaque identifiers, forbidden fields, and neutral RU/UK public
results. It also proves that a structurally forged allow object cannot be passed
to the public formatter.

No existing endpoint, request field, response field, or HTTP status changes in
C20. The current client contract is therefore backward-compatible and unchanged.
The focused C20 suite passes 11/11 and the full source suite passes 107/107.
