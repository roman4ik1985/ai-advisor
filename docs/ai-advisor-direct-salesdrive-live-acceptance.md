# Direct SalesDrive live chat acceptance

Date: 2026-07-29

## Scope

Real local `/api/chat` acceptance requests were issued through the active `api` provider. The inputs contained no personal data. This report intentionally omits questions, answers, product names, YML URLs, keys, raw logs and raw SalesDrive payloads.

## Result

| Check | Result | Evidence summary |
| --- | --- | --- |
| Success response contract | PASS | All six real requests returned HTTP 200 with unchanged keys: `answer`, `catalog`, `catalogDiagnostics`, `knowledge`, `provider`. |
| Direct YML price | PASS | A public in-stock YML item returned `catalogDiagnostics.code=OK`, 12 ranked cards and a price in the assistant answer. |
| Direct YML availability wording | FAIL | The exact-item availability request had `catalogDiagnostics.code=OK` and 12 ranked cards, but the assistant escalated to manager wording rather than stating the explicit YML availability. |
| Direct API delivery methods wording | FAIL | The direct delivery dictionary probe is non-empty, but the assistant response escalated to a manager instead of listing allow-listed methods. |
| Delivery-deadline guard | PASS | The deadline request returned no delivery promise and used safe clarification/manager wording. |
| Route and validator path | PASS | Runtime emitted route and validation metadata for each request; all observed responses used the existing public success contract. |
| Secret-safe runtime logs | PASS | A marker-only scan found no API-key, YML-URL, OpenAI-key or `publicKey` markers in runtime log files. Six new learning records have request IDs and provider metadata. |
| Runtime health | PASS | Local and public `/health` both returned HTTP 200 after the checks. |

## Acceptance decision

The release is operational and safe for price lookup plus conservative delivery handling, but it is **not** complete for public availability or delivery-method answers. The direct resolvers are healthy; the remaining defect is response behavior: the model does not consistently use the supplied explicit live evidence for those two intents.

## Follow-up boundary

Do not add order-status lookup or customer data. The next implementation slice should make availability and delivery-method rendering deterministic from the already-projected SalesDrive evidence, then repeat this same redacted acceptance suite.

## Deterministic rendering remediation, 2026-07-29

- Added a pre-model renderer for confirmed inventory and delivery-method facts. It only uses the projected SalesDrive DTOs already available to the pipeline.
- Inventory output requires an exact YML `IN_STOCK` or `OUT_OF_STOCK` match and includes price only when the router requested a fresh price resolver.
- Delivery output contains allow-listed method labels only. A request for a deadline bypasses the renderer and remains on the existing validator path.
- Source verification passed: 58 automated tests, unchanged successful HTTP response shape, and no secret marker in the source diff. Runtime acceptance is recorded separately after release.

## Runtime re-acceptance, 2026-07-29

| Check | Result | Evidence summary |
| --- | --- | --- |
| Release and reload | PASS | Hash-verified release applied; a new SYSTEM-host listener process loaded the new renderer module. |
| Price and availability | PASS | An exact public YML item returned HTTP 200, `catalogDiagnostics.code=OK`, a current price and explicit availability wording from the deterministic SalesDrive response. |
| Delivery methods | PASS | A delivery-method request returned HTTP 200 and explicit delivery-method wording without a deadline promise. |
| Deadline guard | PASS | A deadline request returned HTTP 200 and did not contain a delivery deadline promise. |
| Public contract and health | PASS | All three responses retained the existing success keys; local and public `/health` returned HTTP 200. |
| Secret-safe log scan | PASS | Marker-only scan found no key, YML URL or `publicKey` marker in runtime log files. |

The API output stream is exclusively locked by the SYSTEM host, so this re-acceptance does not read or persist raw route/validation lines. The external response contract, deterministic source tests and redacted runtime behavior are the acceptance evidence.

## Bilingual routing hardening, 2026-07-29

- Russian and Ukrainian price word forms now require the price resolver; unrelated words such as Russian `оценка` do not.
- A delivery-methods-only question requires only the delivery resolver and no longer performs an inventory/catalog lookup because of generic availability wording.
- Deterministic inventory output requires one candidate or a confident full-name/SKU match. Multiple unmatched candidates return a model/SKU clarification without exposing an arbitrary product.
- Live preflight exposed nested product-name ambiguity and nondeterministic price-only wording. The renderer now chooses a unique most-specific full-name/SKU match and renders bilingual price-only answers directly.
- Source verification passed 62/62 tests; the public server contract file is unchanged and the source diff contains no secret markers. Runtime re-acceptance follows the corrected hash-verified release.

### Bilingual runtime re-acceptance

The corrected renderer was hash-verified in the active runtime and loaded by a new SYSTEM-host process. Five non-personal local `/api/chat` checks passed:

- Russian exact-item price returned current YML price with direct SalesDrive wording.
- Ukrainian exact-item price returned current YML price with direct SalesDrive wording.
- Delivery-methods-only returned method wording with `catalogDiagnostics.code=SKIPPED_BY_ROUTE` and no catalog cards.
- Exact-item inventory returned explicit availability without adding an unrequested price.
- A multi-product inventory query returned a model/SKU clarification and named none of the returned products.

Every response returned HTTP 200 with the unchanged success keys and a request ID. Local/public health returned HTTP 200; marker-only runtime-log scan found no key, YML URL or `publicKey` marker. Bilingual routing hardening acceptance: **PASS**.

## Freshness fail-closed hardening, 2026-07-29

- Direct SalesDrive YML/API results now carry explicit `FRESH`, `STALE` or `UNAVAILABLE` state.
- Stale last-known-good YML remains available only to the internal client diagnostic path. The request pipeline removes stale products from the public catalog and live facts.
- Deterministic price, stock and delivery rendering requires an `AVAILABLE + FRESH` resolver. The validator also rejects live timestamps older than ten minutes.
- A required stale or unavailable price/inventory/delivery resolver returns a language-aware manager fallback without invoking the model.
- Fault-injection coverage includes YML fresh-to-stale-to-expired transitions, SalesDrive API HTTP failure/timeout, stale renderer inputs, expired validator evidence and pipeline suppression of stale public catalog data.
- Source verification passes 67/67 tests. Public `/api/chat` success keys remain unchanged. Runtime release and live acceptance are recorded after deployment.
