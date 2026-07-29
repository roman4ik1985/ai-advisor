# AI Advisor P5 staging acceptance

Date: 2026-07-29
Agent OS task: `TASK-2026-07-29-122006-657`

## Result

| Contour | Status | Evidence |
|---|---|---|
| C50 OpenCart staging preflight | PASS | Existing isolated `https://ledprojector.com.ua/dev/` installation is registered in Softaculous, uses its own database and database user, and is protected by HTTP Basic authentication. |
| C51 backup and restore proof | PASS with limitation | JetBackup 5 exposes 12 incremental Home Directory and database restore points; latest visible point is 2026-07-27. Both staging footer files were copied outside the web root and restored byte-for-byte by SHA-256 before installation. The attempted new Softaculous full backup stalled at database backup and produced no archive, so it is not counted as evidence. |
| C52 staging installation | PASS | Widget CSS/script were added to the source and active OCMOD copies of the CyberStore footer. Only staging files and staging cache were changed. |
| C53 store regression | PASS with staging limitation | Widget and store routes pass the functional matrix. Production clean-cache desktop/mobile acceptance mounted the live widget; warm mobile LCP was 964 ms, CLS 0, and the tested interaction produced no Event Timing entry at or above 16 ms. Exact isolated staging widget delta remains unavailable. |
| C54 limited rollout | PASS | OpenCart Modifications refresh and Lightning Clear Caches completed. Source and generated CyberStore footers both contain the embed, public HTML references the active Lightning widget bundle, clean-cache browser mount/open/close/focus passed, five production routes returned HTTP 200, and browser error events were zero. |

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

## Production post-refresh acceptance

- The first audit found the Lightning cache cleared but OCMOD not refreshed.
- The operator then completed OpenCart Modifications refresh followed by
  Lightning Clear Caches.
- Source and refreshed generated footers both contain the CSS and JavaScript
  embed; the generated footer timestamp is 2026-07-29 13:25:24 +0300.
- Lightning publishes the widget inside `141939397cs_wp.js`; the bundle returns
  HTTP 200, contains the widget root and production API endpoint, and differs
  from the source widget only by Lightning wrapper delimiters.
- The initial false negative came from a two-byte stale response held in the
  isolated test browser cache under the immutable bundle URL. Clearing only
  that test cache loaded the full bundle; no production file change was needed.
- Clean-cache browser acceptance mounted one `.lp-agent-root`, set the loaded
  guard, opened with focus in `#lp-agent-input`, closed with focus returned to
  the launcher, and reported zero runtime/log/network error events.
- Homepage, category, product, cart and checkout routes returned HTTP 200 and
  referenced the active widget bundle; checkout redirected to SimpleCheckout.
- Warm mobile 390x844 measured LCP 964 ms, CLS 0, TTFB 234.6 ms and load
  2,600.2 ms. The tested open/close interaction produced no Event Timing entry
  at or above the 16 ms observer threshold.
- Cold-cache requests temporarily exceeded 20-60 seconds immediately after the
  clear, then the control homepage recovered to HTTP 200 in 1,561 ms.
- Public AI API health remained HTTP 200 throughout.
- No rollback trigger remained after recovery; C54 is accepted.

## Access cleanup

The temporary staging-only Basic Auth user created for this acceptance was
removed after testing. A request with the removed credentials returns HTTP 401.
The existing owner account remains in the authentication file.
