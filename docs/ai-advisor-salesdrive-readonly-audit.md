# SalesDrive → AI Advisor: direct read-only source contract

Date: 2026-07-29

Scope: architecture and official-contract verification only. No SalesDrive request using project credentials, YML download, runtime change, secret read, sync, webhook, database write, or customer-data access was performed.

## Decision

AI Advisor will read live data directly from SalesDrive on the server side. ERP is not part of this data path.

```text
Browser widget
  → AI Advisor backend
    → SalesDrive product YML export
    → SalesDrive read APIs
```

The widget and model must never receive the SalesDrive API key or the full YML URL. A YML URL containing `publicKey` is credential material and must be protected like an API key.

## Officially supported direct sources

SalesDrive's official API page lists read access to orders, products, currency rates, payment methods, delivery methods, statuses and document lists. The official product-export guide instructs consumers to create an enabled YML export and periodically download that URL; SalesDrive updates the feed automatically and explicitly describes it as suitable for stock updates.

Official references:

- https://salesdrive.ua/knowledge/api/
- https://salesdrive.ua/knowledge/api/get-products-from-yml/
- https://salesdrive.ua/features/stock/

The exact tags and warehouse representation must be validated against the store's real YML export before public price or availability answers are enabled.

## Direct resolver split

| AI intent | Direct SalesDrive source | Data allowed into the AI evidence object |
| --- | --- | --- |
| Product search and recommendation | YML export | stable product id, SKU, name, category, public description/specification fields, URL/image when present |
| Current price | YML export | price, old price when explicitly tagged, currency, feed fetch time |
| Availability | YML export | stock/availability fields confirmed from the real feed, normalized availability state, feed fetch time |
| Delivery/payment options | SalesDrive API dictionaries | id, public label, fetch time |
| Order status | SalesDrive order-list API | public order reference, normalized status/payment/delivery/tracking fields, update time |
| Operational documents | SalesDrive document-list APIs | excluded from the public assistant unless a later business case authorizes a narrow DTO |

Order-list and webhook payloads contain contact details and other personal/business data. Raw payloads must not be sent to the model. Anonymous order lookup is forbidden: it requires customer authentication or a separate ownership-verification flow; otherwise the assistant escalates to a manager.

## Direct client safety contract

The AI Advisor backend must implement two isolated read-only clients:

1. `SalesDriveYmlClient`
   - exact HTTPS host allowlist;
   - YML URL only in server-side secret configuration;
   - redirect host validation, timeout and maximum response size;
   - XML parsing with DTD/external entities disabled;
   - bounded cache with `fetchedAt`, last-known-good fallback and explicit stale state;
   - no YML body or secret URL in logs, errors, prompts or public responses.
2. `SalesDriveApiClient`
   - dedicated server-side API key and account/subdomain;
   - GET-only allowlist for the endpoints required by the selected intent;
   - timeout, bounded retry, concurrency limit and circuit breaker;
   - response projection to allow-listed DTOs before model use;
   - PII redaction and request-id-only operational logging.

Every live evidence object must contain `source: "salesdrive"`, `fetchedAt`, `freshness`, and either normalized data or an explicit `unavailable` reason. The deterministic validator remains authoritative: stale/missing evidence blocks price, availability and delivery promises.

## Configuration required later

- SalesDrive account/subdomain;
- dedicated API key with the minimum available permissions;
- enabled product YML export URL;
- stock policy: aggregate all warehouses or expose only selected warehouses;
- cache/freshness thresholds and public wording for zero, low and unknown stock;
- customer-authentication/ownership rule before order lookup is enabled.

These values must be supplied through protected server configuration during a separately authorized runtime step. They must not be committed to Git or pasted into project documents.

## Audit result

- Direct SalesDrive architecture: APPROVED by user decision.
- Official API/YML capability verification: PASS.
- Real account/YML field validation: pending credential-authorized read-only probe.
- Direct clients and AI routing: not implemented in this documentation-only correction.

## Release preflight, 2026-07-29

- The dedicated direct-resolver release manifest now includes `salesdrive-yml.mjs` and `salesdrive-api.mjs`.
- `SALESDRIVE_YML_URL` is absent from the checked AI Advisor runtime/source configuration and from the existing ERP integration configuration. The YML probe cannot be formed without an enabled export URL.
- Existing server-side SalesDrive subdomain/API-key material was detected only by presence and used for one direct, read-only dictionary probe. The request failed before an HTTP response with a socket-level connection failure; no key, URL, response body or customer data was printed or persisted.
- Active runtime release and restart are intentionally withheld: releasing without a configured YML source would degrade product/price evidence, and the direct API path has no successful connectivity proof.
- ERP dependency: removed from the target architecture.

## Direct runtime verification, 2026-07-29

- The active-runtime configuration now contains all three required values. Validation was presence- and format-only; no secret, full YML URL or configuration value was printed.
- Read-only direct probes passed: product YML returned normalized price and explicit availability evidence; delivery, payment and status dictionaries returned non-empty allow-listed results.
- The 15-file tracked release, including both direct SalesDrive resolver modules, was applied to `F:\Services\AI Advisor` with SHA-256 verification. The release helper does not copy `.env`.
- The SYSTEM-owned `AI Advisor API Host` was subsequently stopped and started from an elevated operator session. A new listener process is running; seven released runtime modules match source SHA-256 hashes, and local plus public `/health` return HTTP 200.
