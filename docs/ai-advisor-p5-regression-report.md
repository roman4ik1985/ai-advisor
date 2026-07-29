# AI Advisor P5 regression report

Date: 2026-07-29

## Scope

This report covers the authorized OpenCart staging installation and read-only
production canary. It does not cover Telegram/Redis provisioning, order lookup,
customer data, checkout submission, active AI runtime deployment or secret
changes.

## Automated baseline

- full source suite before P5: 205/205 PASS;
- P4 widget/security/quality budgets: PASS;
- knowledge validation: 44/44 PASS.

P5 changes only remote OpenCart staging footer integration and project
documentation. Application source and active AI runtime were not changed.

## Staging browser matrix

| Check | Result |
|---|---|
| Homepage renders | PASS |
| Category renders | PASS |
| Product detail renders | PASS |
| Empty cart renders | PASS |
| Checkout entry redirects to SimpleCheckout | PASS |
| Widget CSS and JavaScript load from the public AI host | PASS |
| Widget root mounts on every tested route | PASS |
| Launcher open/close | PASS |
| Focus enters input on open | PASS |
| Focus returns to launcher on close | PASS |
| Browser console error/warning entries | 0 |
| Order/customer mutation | Not performed |

Observed end-to-end navigation elapsed time from the automation surface ranged
from about 3.1 s to 9.7 s. This includes browser-control overhead and is not a
Web Vitals measurement.

## Findings

1. Staging has legacy PHP 8 warnings/notices visible in the document. This is an
   environment defect unrelated to the widget and must be removed before the
   staging URL is treated as customer-facing.
2. The active CyberStore footer is served from the OCMOD generated tree.
   Updating only the source theme footer is insufficient.
3. Production source and OCMOD footer files already contain the AI Advisor
   snippet, but generated storefront HTML does not. Rotating only Lightning
   page cache produced the same result.
4. The cache canary was atomic and recoverable: the original 8,711-file
   `alpha` page-cache tree was restored, the 21 newly generated canary files
   were removed, and production remained on its pre-canary cache.
5. A one-shot web-level `opcache_reset()` probe returned unavailable and its
   temporary file was immediately removed.
6. After the authorized operator cache action, the Lightning working cache file
   was absent, but the generated OCMOD footer retained its 2026-07-23 timestamp.
   The public document contains the widget CSS, no widget script, and mounts
   zero `.lp-agent-root` elements. This isolates the remaining blocker to the
   unrefreshed OCMOD/template compilation step rather than page-cache warming.
7. A production mobile baseline at 390x844 measured LCP 2,080 ms, CLS 0,
   TTFB 1,658.8 ms, DOMContentLoaded 2,366.6 ms, load 2,682.4 ms and navigation
   transfer size 48,116 bytes. INP was unavailable after the short safe menu
   interaction. Because the widget did not mount, this is not a widget-on
   performance acceptance result.
8. The operator subsequently completed the OpenCart Modifications refresh and
   Lightning Clear Caches in the required order. Fresh cache-busted public HTML
   still contained neither the widget script nor a mounted root. Initial
   cold-cache storefront requests timed out at 20-60 seconds, but the control
   homepage then recovered to HTTP 200 in 1,561 ms while AI API health stayed
   HTTP 200. No rollback was required.
9. Read-only server comparison proved that both source and generated footers
   contain the embed. Public HTML references `141939397cs_wp.js`, whose complete
   HTTP response contains the widget and API endpoint. The earlier zero-root
   result was caused by an isolated test browser retaining a two-byte stale
   response for that immutable URL. Clearing only the test browser cache loaded
   the complete bundle and mounted the widget without a server-file change.
10. Clean-cache production acceptance passed mount, open/close, input focus,
    launcher focus restoration, five HTTP 200 storefront routes and zero
    browser error events. Warm mobile 390x844 measured LCP 964 ms and CLS 0;
    the tested interaction produced no Event Timing entry at or above 16 ms.

## Verdict

C50–C54 are accepted. The isolated staging environment still lacks a directly
comparable widget-on/widget-off Web Vitals delta, but production clean-cache
desktop/mobile functional acceptance, warm LCP/CLS evidence, route coverage and
rollback gates pass. No order or customer mutation was used.
