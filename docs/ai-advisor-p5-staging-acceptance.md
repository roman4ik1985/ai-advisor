# AI Advisor P5 staging acceptance

Date: 2026-07-29
Agent OS task: `TASK-2026-07-29-122006-657`

## Result

| Contour | Status | Evidence |
|---|---|---|
| C50 OpenCart staging preflight | PASS | Existing isolated `https://ledprojector.com.ua/dev/` installation is registered in Softaculous, uses its own database and database user, and is protected by HTTP Basic authentication. |
| C51 backup and restore proof | PASS with limitation | JetBackup 5 exposes 12 incremental Home Directory and database restore points; latest visible point is 2026-07-27. Both staging footer files were copied outside the web root and restored byte-for-byte by SHA-256 before installation. The attempted new Softaculous full backup stalled at database backup and produced no archive, so it is not counted as evidence. |
| C52 staging installation | PASS | Widget CSS/script were added to the source and active OCMOD copies of the CyberStore footer. Only staging files and staging cache were changed. |
| C53 store regression | FUNCTIONAL PASS / STAGING PERF PENDING | Widget and store routes pass the functional matrix below. A production mobile baseline was collected at 390x844, but exact staging widget-on LCP/CLS/INP and widget delta remain pending. |
| C54 limited rollout | BLOCKED | The authorized OpenCart Modifications refresh and subsequent Lightning Clear Caches both completed, but fresh public HTML still contains no widget script or mounted root. The refreshed generated footer must now be compared read-only with the source footer before any further production change. |

## Staging installation

The active theme is CyberStore. OpenCart OCMOD has a generated footer copy, so
both of these staging files are required:

- `catalog/view/theme/cyberstore/template/common/footer.tpl`
- `system/storage/modification/catalog/view/theme/cyberstore/template/common/footer.tpl`

The installed assets are:

- `https://ai.ledprojector.com.ua/widget.css?v=20260729p5`
- `https://ai.ledprojector.com.ua/widget.js?v=20260729p5`
- endpoint `https://ai.ledprojector.com.ua/api/chat`

The exact pre-change copies are stored outside the web root under the private
account backup directory. Restore drills for both files returned their original
SHA-256 hashes before the widget was installed.

## Functional acceptance

The following routes loaded the widget root and the expected asset URLs:

| Route | Store result | Widget |
|---|---|---|
| Homepage | PASS | PASS |
| `/proektory` | `ПРОЕКТОРИ` | PASS |
| `/jenovox-m4000` | `Jenovox M4000` | PASS |
| `index.php?route=checkout/cart` | `Кошик замовлень` | PASS |
| `index.php?route=checkout/checkout` | Redirected to `checkout/simplecheckout` | PASS |

Widget interaction checks:

- launcher changes `aria-expanded` from `false` to `true`;
- opening moves focus to `#lp-agent-input`;
- close returns focus to the launcher;
- browser log contains no `error` or `warning` entries produced by the widget;
- no order was created, modified or submitted;
- no Telegram, Redis or customer/order data operation was performed.

## Known staging limitations

The old staging copy renders pre-existing PHP 8 warnings/notices before the page
content, including `microdatapro.php` and CyberStore menu/slider code. They are
present across store routes and are not introduced by AI Advisor. Production
does not render these warnings.

The staging browser surface used for the authorized acceptance did not expose a
mobile viewport or Web Vitals instrumentation. A later production baseline was
collected through CDP at 390x844 after the authorized Lightning cache clear:
LCP 2,080 ms, CLS 0, TTFB 1,658.8 ms, DOMContentLoaded 2,366.6 ms, load
2,682.4 ms and navigation transfer size 48,116 bytes. INP was not produced by
the short safe menu interaction. The widget root count was zero, so these
numbers are a storefront-without-widget baseline and do not satisfy the staging
widget performance gate.

## Production post-refresh audit

- The first audit found the Lightning cache cleared but OCMOD not refreshed.
- The operator then completed OpenCart Modifications refresh followed by
  Lightning Clear Caches.
- Fresh cache-busted public HTML still contains no `widget.js` or `ai-advisor`
  script marker.
- `.lp-agent-root` count is zero on desktop and mobile.
- Cold-cache requests temporarily exceeded 20-60 seconds immediately after the
  clear, then the control homepage recovered to HTTP 200 in 1,561 ms.
- Public AI API health remained HTTP 200 throughout.
- The recovered storefront did not require rollback, but C54 remains blocked.

## Access cleanup

The temporary staging-only Basic Auth user created for this acceptance was
removed after testing. A request with the removed credentials returns HTTP 401.
The existing owner account remains in the authentication file.
