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

## Verdict

C50–C52 are accepted. C53 is accepted for desktop functional behavior, with
mobile viewport and exact LCP/CLS/INP still pending. C54 remains blocked until
the hosting/OpenCart control plane refreshes the compiled template/Lightning
runtime and the public HTML contains the widget assets.
