# AI Advisor — product-aware MVP source acceptance

Date: 2026-07-29

## Scope

Source-only implementation and acceptance for roadmap C10–C15:

- canonical product schema and aliases;
- deterministic recommendation and comparison;
- product cards in the chat;
- OpenCart DOM matching;
- explicit product navigation and safe mascot guidance;
- desktop/mobile/reduced-motion and accessibility acceptance.

No active runtime, `F:\Services\AI Advisor`, `.env`, secret, SalesDrive customer/order payload, OpenCart/cPanel, Tunnel or remote was accessed or changed.

## Result

| Contour | Result | Evidence |
|---|---|---|
| C10 — product schema and aliases | PASS | Bounded additive DTO preserves existing compatibility fields and adds stable identity, aliases, official URLs, specifications, images, provenance, fetchedAt and freshness |
| C11 — recommendation and comparison | PASS | RU/UK budget and exact alias/SKU comparison are deterministic, use only fresh provenance-backed facts, return at most three products and never invent a winner |
| C12 — product cards | PASS | The widget consumes the existing `catalog` array, validates official HTTPS URLs again, deduplicates and renders at most three cards through DOM APIs/textContent |
| C13 — DOM adapter | PASS for source fixtures | Deterministic priority is canonical URL, product ID, SKU, then exact normalized name/alias; no substring match |
| C14 — navigation and mascot UX | PASS | Scroll/navigation occurs only after an explicit visitor action; target highlight/focus and bounded desktop guidance reset after eight seconds; mobile and reduced motion never move the mascot |
| C15 — source UI acceptance | PASS | Automated fake-DOM contracts plus local real-browser desktop, mobile and reduced-motion checks passed |

The successful public `/api/chat` top-level keys remain unchanged:

- `answer`
- `catalog`
- `catalogDiagnostics`
- `knowledge`
- `provider`

## Safety and evidence contract

- Product recommendations accept only `FRESH` products with valid `fetchedAt` and provenance.
- Explicit budgets are applied only to confirmed parseable UAH prices.
- Explicit requested specifications must be present in the canonical product evidence.
- Missing comparison values are displayed as unconfirmed.
- Unknown concrete products do not trigger the broad recommendation fallback.
- Broad product advice may retry the already-cached SalesDrive feed with an empty identity query; it does not create a second network fetch.
- Product and image URLs must use HTTPS, the approved LedProjector host, no credentials and no custom port.
- Raw HTML, model HTML and `catalogDiagnostics` are never rendered as product-card content.
- Technical backend error text is not shown to the visitor.

## Accessibility basic check

Target: WCAG AA for the changed widget surface.

| Check | Result | Notes |
|---|---|---|
| High-risk violations | PASS | No unsafe HTML, inaccessible click-only element or automatic navigation introduced |
| Text alternatives | PASS | Product images are decorative beside a linked product name and use empty `alt`; interactive controls have accessible names |
| Keyboard and focus | PASS | Product links/actions are keyboard reachable; explicit «Показать товар» focuses the matched store card; close restores focus |
| Form labels | PASS | Message input retains its programmatic label; send/close/open controls retain accessible names |
| Semantics | PASS | Nonmodal dialog remains `aria-modal="false"`; recommendations use a labelled region, heading, list and list items |
| Status and busy state | PASS | Answer, guide and busy states retain live-region/`aria-busy` contracts |
| Reduced motion | PASS | Browser emulation confirmed highlight/focus with no mascot movement |
| Contrast | PASS for source palette | Header status is white on a darkened gradient; the weakest changed header stop is approximately 5.36:1. Product action is approximately 6.16:1; product availability and error text exceed 7:1 |

## Verification

- Full source suite: 96/96 PASS.
- Focused C10–C15 suite: 60/60 PASS.
- JavaScript syntax checks: PASS.
- `git diff --check`: PASS.
- Local browser desktop:
  - exactly three cards rendered from four mock catalog entries;
  - explicit «Показать товар» scrolled to, focused and highlighted the offscreen exact DOM match;
  - panel closed and desktop guide activated without covering the target.
- Local browser mobile at 390×844:
  - three cards rendered;
  - explicit navigation focused/highlighted the target;
  - mascot guide remained docked.
- Local browser reduced-motion at 1024×768:
  - media query reported reduced motion;
  - target focus/highlight passed;
  - mascot guide remained docked.
- Browser console warnings/errors: 0.

## Remaining boundary

This is source acceptance, not active-runtime or real-store acceptance. A separately authorized runtime release must use the updated tracked release helper and repeat source/runtime diff, local/public health and redacted API checks. Real OpenCart browser matrix, checkout regression and production Web Vitals remain C50–C53/C45 because the current contour explicitly excludes OpenCart/cPanel and production changes.
