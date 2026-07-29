# AI Advisor P5 rollout and rollback runbook

Date: 2026-07-29
Current state: C54 blocked; production storefront unchanged

## Release gate

Do not declare production rollout complete until all conditions are true:

1. OpenCart Modifications are refreshed or the active compiled CyberStore
   footer is invalidated through the authorized admin/hosting control plane.
2. Lightning caches are cleared through its own `Clear Caches` action.
3. Public HTML for homepage, category, product, cart and checkout contains the
   AI Advisor widget asset URLs.
4. The widget mounts and passes launcher/focus checks in a normal customer
   browser.
5. Browser errors remain zero and the store's existing cart/checkout behavior
   is unchanged.
6. Mobile viewport plus LCP/CLS/INP evidence satisfy the P4 performance budget.

The server currently does not allow web `opcache_reset()`. A PHP process restart
or equivalent hosting action must be performed only through an authorized
control-plane operation.

## Controlled rollout

1. Confirm the latest JetBackup Home Directory and database restore points.
2. Copy the current source and OCMOD footer files to the private backup
   directory and record SHA-256 hashes.
3. Refresh OpenCart Modifications.
4. Clear Lightning caches through the OpenCart Lightning admin action.
5. Warm, in order: homepage, category, one product, cart, checkout.
6. Verify widget asset URLs, mount, open/close, keyboard focus and browser logs.
7. Observe health/error rate and customer-facing pages before expanding beyond
   the five warmed routes.

No order should be submitted during rollout verification.

## Rollback triggers

Rollback immediately if any of the following occurs:

- storefront HTTP failure or blank page;
- cart/checkout regression;
- new browser errors caused by the widget;
- widget blocks purchase controls;
- material LCP/CLS/INP budget regression;
- AI API health degradation associated with the release.

## Rollback procedure

1. Restore the pre-change source and OCMOD footer copies from the private
   account backup directory and verify their recorded SHA-256 hashes.
2. Refresh OpenCart Modifications.
3. Clear Lightning caches through the authorized admin action.
4. Warm and verify the five release-gate routes without the widget.
5. If file-level rollback is insufficient, use the latest JetBackup Home
   Directory restore point; database restore is not expected for this
   file-only integration and requires separate explicit approval.

## Evidence from the 2026-07-29 canary

- JetBackup: 12 visible incremental restore points, latest 2026-07-27.
- Staging source-footer restore check: PASS.
- Staging OCMOD-footer restore check: PASS.
- Production Lightning cache rotation: did not activate the widget.
- Production Lightning cache rollback: PASS, original 8,711 page files restored.
- Authorized production Lightning clear: completed; working cache file absent.
- Production OCMOD refresh: not completed; generated footer timestamp remained
  `2026-07-23 15:51:55 +0300`.
- Public post-clear result: widget CSS present, widget script absent, mounted
  widget roots 0.
- Production mobile 390x844 baseline without widget: LCP 2,080 ms, CLS 0,
  TTFB 1,658.8 ms, load 2,682.4 ms; INP unavailable.
- Temporary web reset probe: removed.
- Temporary staging authentication user: removed and rejected with HTTP 401.
