# AI Advisor — public catalog dry-run

## Scope

Read-only collection from the public `https://ledprojector.com.ua/sitemap-product.xml` and four public policy pages. The collection does not use OpenCart Admin, ERP, runtime files, cookies, secrets, or authenticated endpoints.

## Result

Captured at `2026-07-29T00:43:05.995Z`:

| Entity | Count | Coverage |
|---|---:|---|
| Public projector pages | 10 | name, canonical URL, current public price, public availability label, five image URLs, source URL and source hash |
| Product specifications | 359 | 31–40 key/value pairs per product |
| Public policy pages | 4 | payment, delivery, warranty, exchange/return; summary, provenance and source hash |
| Public SKU | 0 | not exposed in this sample's public structured markup |

The raw machine-readable dataset is `data/ai-advisor-public-catalog-dry-run.json`.

## Data contract

Each product retains `capturedAt`, `sourceUrl`, and `sourceHash`. Prices are public-page observations only. `publicAvailability` is retained as a storefront label, not as physical stock, reservable quantity, delivery promise, or authority for the live inventory resolver.

The dataset is raw public evidence, not approved `knowledge/store-faq.json` content. Any fact promoted into knowledge requires source review and the project knowledge workflow.

## Confirmed gaps

- No public SKU was available in the collected JSON-LD markup.
- Physical stock, reserve, available quantity, personal price, and delivery date remain unavailable without an authorised read-only source.
- This sample is intentionally limited to ten projector pages; it proves parsing coverage but is not a whole-catalog snapshot.

## Next use

Use the dataset to define the durable product/specification schema and product-alias mapping. Connect price, inventory, and delivery only through separate freshness-controlled read-only resolvers.
