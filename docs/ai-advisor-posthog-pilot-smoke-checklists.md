# AI Advisor PostHog pilot smoke checklists

These are tester instructions, not developer acceptance results. They require
an independently authorized test environment and, where stated, PostHog access.

## Privacy smoke

- Confirm the dedicated project has autocapture, pageview/pageleave capture,
  session replay, heatmaps, surveys, exception capture, rage/dead clicks,
  campaign attribution, referrer capture, IP capture, and person profiles off.
- Confirm no `identify()` or `alias()` call exists.
- Submit synthetic values resembling email, phone, JWT, Bearer token, API key,
  URL query/fragment, order ID, SalesDrive payload, raw error, stack trace,
  prompt, question, and answer. Every event must be rejected before PostHog.
- Confirm `distinct_id` is a random widget-lifecycle UUID and no person profile
  is created.
- Confirm payload properties match the documented per-event allowlist exactly.
- Confirm no console or ordinary server log contains an event payload or token.

## Local and integration smoke

- Start with analytics disabled and verify widget mount/open, chat, product
  navigation, and Telegram status flow still work.
- Mock the SDK as unavailable and as throwing; repeat the functional checks.
- Mock PostHog network failure; confirm the API and widget have no uncaught
  exception and no infinite retry.
- Verify one `widget_shown` per widget lifecycle and one event for each actual
  `closed -> open` transition.
- Verify:
  `widget_shown -> widget_opened -> question_submitted -> answer_completed -> product_opened`.
- Verify:
  `widget_shown -> widget_opened -> question_submitted -> answer_failed`.
- Verify a manual retry creates a new UUID with `was_retried = true`.
- Verify one interaction never has both terminal outcomes.
- Verify a product click keeps its originating interaction UUID.

## Staging smoke

- Use a staging-only project token and `environment = staging`.
- Confirm the pilot window is exactly 30 UTC calendar days.
- Confirm synthetic traffic uses `traffic_type = synthetic`.
- Inspect the storefront CSP and compiled Lightning bundle before deployment.
  The server-proxied design should require no PostHog domain in storefront CSP.
- Compare widget asset size and representative LCP/CLS/INP against the accepted
  baseline.
- Exercise desktop/mobile, keyboard, reduced motion, ad blocker, and blocked
  PostHog host scenarios.

## Network payload inspection

In browser DevTools, filter to `/api/analytics/event`. Inspect request bodies
without copying real user data into reports. Confirm:

- only event name, random analytics session UUID, and allowlisted properties;
- no URL, pathname, query, fragment, referrer, DOM text, form value, question,
  answer, order reference, headers, cookies, or SalesDrive data;
- the PostHog project token is absent from browser traffic.

On the server-to-PostHog boundary, use a synthetic mock or separately authorized
proxy inspection. Confirm `$process_person_profile = false` and GeoIP disabled.

## PostHog Live Events

- Use only synthetic traffic.
- Confirm all required implemented events appear with the expected schema.
- Confirm no person profile is created.
- Confirm production dashboard filters exclude the synthetic event.
- Confirm no unexpected automatic `$pageview`, `$pageleave`, `$autocapture`,
  exception, performance, or replay event appears.

## Kill switch and expiry

- Set `AI_ADVISOR_ANALYTICS_ENABLED=false`, restart the API if required by the
  runtime configuration mechanism, and confirm the public analytics config says
  disabled and no event POST is attempted afterward.
- Test one instant before `PILOT_END` and at `PILOT_END`; the latter must be a
  no-op.
- Invalid/missing dates or a period other than exactly 30 days must be a no-op.
- Changing a browser clock must not extend the server-authoritative UTC window.

## Production smoke

Production deployment, enablement, Live Events, and payload inspection require
separate authorization. Deploy disabled first, verify health/readiness and the
existing five-route widget monitor, then enable only after the privacy gates and
dedicated project settings are independently confirmed. Roll back immediately
with `AI_ADVISOR_ANALYTICS_ENABLED=false` on any Critical/High finding.
