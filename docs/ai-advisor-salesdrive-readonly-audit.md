# SalesDrive → AI Advisor: read-only audit

Date: 2026-07-29
Scope: source-code and contract audit only. No SalesDrive request, ERP runtime request, sync, webhook, database write, credential read, runtime change, or secret exposure was performed.

## Decision

SalesDrive is suitable as the authoritative operational source for an authenticated customer's order progress and for delivery/payment/status dictionaries. It is **not** currently a safe live source for the public AI Advisor's product price or availability answers.

The AI Advisor must use a narrow, read-only ERP adapter. It must not call SalesDrive directly, receive a SalesDrive API key, or receive raw `integration_documents.payload`.

## Verified current contract

The current ERP SalesDrive sync supports exactly these paged entities:

- `orders`, `payments`, `invoices`, `sales_invoices`, `cash_orders`;
- `arrival_products`, `acts`, `contracts`, `checks`.

`GET /salesdrive/settings`, sync-run/status, document and materialized-order read endpoints exist, but all require the ERP SalesDrive `admin` or `manager` role plus `integrations.read`. They are operator/read-side APIs, not a public AI integration API.

Orders materialize products from individual order lines. The available line-level product data is:

- identity: `productId`, `parameter`, `sku`, `barcode` with name fallbacks;
- commercial history: `price`, quantity and order context;
- optional category identifiers/names stored in the SalesDrive attribute payload.

This is purchase/order history, not a complete catalogue. The materializer writes the line `price` to local `Product.basePrice`; therefore it can be stale and must not be shown as a current public price.

Current stock is represented by ERP `InventoryBalance(productId, warehouseId, quantity)`, not by a SalesDrive product catalogue endpoint. `arrival_products` has a separately guarded posting path, but it is not a general "current availability" feed.

No current source-code reference to `export.yml`, `publicKey`, or a SalesDrive product/category feed was found in the ERP repository. Earlier documentation refers to a YML/publicKey flow outside the standard paged sync contract; that flow remains unverified here and must be validated before it is treated as a data source.

## Safe data boundary for AI

| AI question | Permitted source | Response fields | Rule |
| --- | --- | --- | --- |
| "Where is my order?" | SalesDrive order via ERP adapter | order number, normalized status, payment state, delivery method, tracking number, updated time | Require customer authentication and an order-ownership check. |
| "How do delivery/payment work?" | SalesDrive dictionaries via ERP adapter | label/id, updated time | No customer payload. |
| "What is the current price?" | Current public catalogue or an explicitly promoted ERP price source | price, currency, fetched time | Do not use historical SalesDrive order-line price. |
| "Is it in stock?" | ERP inventory resolver | availability band, warehouse policy, updated time | Do not infer stock from orders or arrivals. |
| "Which model suits me?" | Verified knowledge + public catalogue | specifications and provenance | Keep availability/delivery promises manager-confirmed until a live inventory contract is authorized. |

Never return raw order documents, contact data, address, phone, email, internal notes, API keys, credentials, or detailed integration errors to the model or widget.

## Required next implementation slice

Create an internal, read-only ERP-to-AI adapter with service authentication and allow-listed DTOs:

```text
GET /internal/ai-advisor/order-status/{publicOrderReference}
GET /internal/ai-advisor/delivery-options
GET /internal/ai-advisor/payment-options
GET /internal/ai-advisor/availability/{sku}
```

The order-status route must use a customer/session ownership check; it must not accept a raw SalesDrive id as anonymous public access. Every DTO must include `source`, `updatedAt`, and an explicit `freshness`/`unavailable` state. The AI Advisor will route only authorised intents to these endpoints and continue to escalate when the adapter has no fresh evidence.

## Audit result

- Code-contract audit: PASS.
- Direct SalesDrive data proof: intentionally not run; it would require live runtime/credential scope.
- Product YML/publicKey feed: not present in current ERP source; requires a separate read-only validation task.
- Public AI integration endpoint: absent; implementation is a separate cross-repository change.
