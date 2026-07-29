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

## Fail-closed decision

Order lookup is denied unless every condition below is true:

1. Contract version and purpose match `1.0` and `ORDER_STATUS`.
2. Proof state is `VERIFIED`.
3. The opaque proof-session identifier is valid.
4. Server-side subject, trusted-channel, nonce, and bounded-attempt bindings are
   explicitly verified.
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
- Rate limits must combine visitor/session, opaque proof session, and a
  non-reversible server-side locator digest. Raw locators are not log keys.
- Proof secrets, channel destinations, raw identifiers, and rejection reasons
  must not enter browser-visible data, model context, analytics, or ordinary logs.

## Required decision before C21

C21 remains blocked until the owner chooses a trusted verification mechanism.
Acceptable candidates must be assessed separately, for example an authenticated
customer account or a one-time challenge delivered to the order contact through
a trusted server-side channel. The choice must define delivery ownership,
attempt/rate limits, nonce storage, expiry, atomic consumption, recovery, and
support escalation.

Only after C21 is approved may C22 define a narrow order DTO. C23–C25 remain
disabled. Anonymous lookup and direct use of raw SalesDrive order/customer
payloads remain forbidden.

## Verification

`test/order-ownership-contract.test.mjs` covers the valid gate plus missing proof,
all non-verified states, missing bindings, expiry, clock skew, excessive TTL,
replay, invalid opaque identifiers, forbidden fields, and neutral RU/UK public
results. It also proves that a structurally forged allow object cannot be passed
to the public formatter.

No existing endpoint, request field, response field, or HTTP status changes in
C20. The current client contract is therefore backward-compatible and unchanged.
The focused C20 suite passes 11/11 and the full source suite passes 107/107.
