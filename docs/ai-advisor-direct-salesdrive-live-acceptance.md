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
