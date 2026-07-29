# P3 — knowledge and product evidence operations acceptance

Date: 2026-07-29
Status: C30–C33 source PASS; runtime release deferred

## C30 manager operations

C30 remains complete through the bounded Telegram manager sink, verified-binding
notification toggle and durable at-least-once outbox. Telegram stays disabled
until its separate Redis/bot configuration contour is ready.

## C31 knowledge coverage

- `npm run knowledge:coverage` produces a deterministic read-only report.
- Current source result: 44 knowledge entries, 41 official source URLs,
  zero entries older than 180 days and zero unresolved source-log gaps.
- Repeated official sources and top keywords are visible for editorial review.
- The report cannot mutate `knowledge/store-faq.json`.

## C32 learning review operations

- `npm run learning:review` merges redacted pending learning records with an
  append-only decision ledger.
- Allowed decisions are `DEFER`, `DISMISS` and `DRAFT`.
- `DRAFT` requires an official LedProjector URL but still does not create,
  replace or publish a knowledge entry.
- A write requires explicit `--apply`; preview is the default.
- Canonical knowledge publication remains the separate
  `knowledge:find` → source review → `knowledge:upsert` → `check:knowledge`
  workflow.

## C33 product specification evidence

- `npm run product-specifications:ingest` promotes reviewed official public
  specifications into `knowledge/product-specifications.json`.
- Price, stock, availability, discounts, promotions and delivery promises are
  rejected by the promotion gate.
- Ten product records from the official public capture dated 2026-07-29 were
  reviewed and ingested with URL, capture timestamp, SHA-256 source hash,
  review date and reviewer provenance.
- Runtime enrichment matches SKU first and canonical URL second, fills only
  missing specification fields, and preserves live SalesDrive price, stock and
  existing specification precedence.
- Invalid/missing evidence loads as an empty set and does not block startup.

## Verification

- Focused P3 tests: 10/10 PASS.
- Full source suite: 192/192 PASS.
- Knowledge validation: 44 entries PASS.
- Product evidence records: 10.
- Commercial marker scan in promoted evidence: 0.
- Source learning queue: 0 pending.
- No automatic knowledge mutation, AI call, secret, customer/order data,
  Telegram/Redis operation or active-runtime change was performed.
