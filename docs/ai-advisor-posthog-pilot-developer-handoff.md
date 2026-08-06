# Developer handoff - private PostHog product analytics pilot

Independent local source-test status: **PASSED** on 2026-08-05. This remains a
developer handoff, not a staging/production-readiness or external
privacy-smoke statement.

## 0. Independent staging endpoint verification (2026-08-06)

**Conditional PASS for the staging API boundary only.** With an allowed
`https://ledprojector.com.ua` Origin, the isolated
`https://ai-staging.ledprojector.com.ua` runtime returned public analytics
configuration with `enabled=true`, `environment=staging`, schema version `1`,
and widget version `0.1.0`; it returned `202 {"ok":true}` for one minimal
synthetic `widget_shown` envelope. The request included only the event name,
random lifecycle UUID, and allowlisted properties; no token was exposed.

A second envelope containing a synthetic email-shaped value in a safe-version
field was rejected with `400 INVALID_ANALYTICS_EVENT`, demonstrating the
server-side fail-closed gate before capture. The API returned CORS only for the
storefront origin and marked the configuration response `Cache-Control:
no-store`.

This does **not** verify PostHog project settings, Live Events, the
server-to-PostHog transport payload, person-profile creation, or storefront
browser Network traffic. The isolated `/dev/` storefront is currently behind
HTTP Basic Auth, so that browser acceptance could not be performed in this
session. Production was not queried beyond its health endpoint and was not
changed.

## 1. Implementation summary

The source package adds a disabled-by-default, server-proxied PostHog pilot for
AI Advisor only. The browser has specialized event methods and sends a strict
envelope to the AI Advisor backend. The backend validates it again, applies a
final `beforeSend` gate, and queues an anonymous event through `posthog-node`.
The project token never enters browser code.

## 2. Version and commit

- Package version: `0.1.0`.
- PostHog Node SDK: pinned in `package.json`.
- Agent OS task: `TASK-2026-08-05-232858-904`.
- Implementation commit: the commit containing this handoff; the final task
  report records its exact hash.

## 3. Files

See the task-scoped Git diff. Primary implementation files are
`analytics-pilot.mjs`, `public/widget.js`, `server.mjs`, `.env.example`,
`package.json`, targeted tests, this handoff, dashboard/smoke specifications,
the decision-memo template, README, and canonical wiki updates.

## 4. Architecture decisions

- Separate pilot module; the older C40 JSONL product contract remains intact.
- Server-proxied Node SDK instead of a storefront SDK/CDN.
- The final application allowlist is revalidated in `before_send`. After that
  hook, `posthog-node@5.48.0` adds only its fixed transport metadata
  (`$lib=posthog-node`, `$lib_version=5.48.0`, `$is_server=true`) plus the
  required event UUID/timestamp. These values contain no storefront, URL,
  visitor, prompt, response, DOM, order, or SalesDrive data and are covered by
  an integration test against the installed SDK.
- No new PostHog domain in storefront CSP and no token in the browser.
- Random in-memory widget-lifecycle UUID becomes anonymous PostHog
  `distinct_id`; it is not persisted, identified, or aliased.
- Double validation: browser specialized methods plus authoritative backend
  schema/sanitizer/final gate.
- Analytics is non-blocking and failures are swallowed without payload logging.

## 5. Preliminary audit

- Frontend: plain classic async IIFE in `public/widget.js`; no frontend
  framework or bundler.
- Backend: Node `http` server in `server.mjs`; Node >=20.
- Mount succeeds at `document.body.append(root)` after a public visibility
  check. Open state is closure-local in `setOpen`.
- Chat is non-streaming `POST /api/chat`; client timeout is 55 seconds. Retry is
  manual and has no automatic retry policy.
- Product cards expose safe ID/SKU and user click positions.
- Existing Telegram UI is personal order-status verification. It is not a valid
  purchase handoff event.
- Existing C40 is a disabled local JSONL contract for three product events.
- No PostHog/other browser analytics SDK, CMP/consent integration, or general
  Web Vitals collection exists in the widget. P6 measures Web Vitals only in a
  controlled production probe.
- Deployment uses a raw widget asset, OpenCart/CyberStore footer, Lightning
  cache, and a separately controlled Windows runtime.

## 6. Events

Implemented adapter/schema methods:

`widget_shown`, `widget_opened`, `question_submitted`, `answer_completed`,
`answer_failed`, `product_opened`, `order_handoff_started`, and optional
`answer_feedback_submitted`.

The first six have real widget lifecycle points. `order_handoff_started` and
feedback are schema/API-ready but deliberately not emitted because no valid
pre-PII purchase handoff or approved feedback UI exists.

## 7. Allowed properties

Common: `schema_version`, `environment`, `widget_version`, `locale`,
`page_type`, `traffic_type`.

Per-event properties follow the attached specification and the runtime schema
in `analytics-pilot.mjs`. No arbitrary public `track(name, properties)` method
exists in the widget.

## 8. Forbidden properties

Question/answer/prompt/history text, PII, order/SalesDrive data, URL/path/query/
fragment/referrer, DOM/form values, cookies, headers/tokens, IP/GeoIP, request or
response bodies, raw errors, stack traces, console logs, arbitrary arrays, and
nested objects are rejected.

## 9. Interaction IDs

Each submitted request receives a cryptographically random UUID. The ID links
submit to one terminal result and later product clicks. A terminal guard blocks
completed+failed duplication. Manual retry creates a new interaction with
`was_retried = true`; no intermediate automatic retry exists.

## 10. Environment

Documented in `.env.example`. Activation requires the explicit kill switch,
provider, production/staging environment, project token, approved EU/US ingest
host, safe schema/widget versions, and an exact 30-day UTC date-only window.
CI, test, development, missing/invalid configuration, and expired/future windows
are no-op.

## 11-13. Local run, build, and tests

```powershell
npm install
npm start
node --test test/analytics-pilot.test.mjs test/analytics-pilot-widget.test.mjs
.\scripts\agent-os.ps1 verify run -Profile frontend-full
```

There is no frontend build step. The widget is a served source asset.

## 14-18. Environment and PostHog verification

- Use a dedicated project, preferably EU Cloud.
- Configure IP discard at project level.
- Do not enable replay, autocapture, pageview/pageleave, heatmaps, surveys,
  exceptions, rage/dead clicks, attribution, referrer, or person profiles.
- Never configure a personal API key.
- Test/staging must not use the production project token.
- Live Events and Network payload checks must be performed by the independent
  tester under explicit access.

## 19-23. Smoke instructions

Use [ai-advisor-posthog-pilot-smoke-checklists.md](./ai-advisor-posthog-pilot-smoke-checklists.md).
It covers privacy, staging, production, Network payload, Live Events, kill
switch, expiry, synthetic traffic, and functional failure isolation.

## 24. Known limitations

- Exact project/region/token and pilot dates are not provided.
- Consent/CMP applicability requires an owner/legal decision before activation.
- The actual storefront CSP and compiled Lightning footer were not changed.
- There is no valid purchase `order_handoff_started` lifecycle in current UI.
- Optional feedback UI is not implemented.
- Anonymous in-memory lifecycle IDs do not correlate across full page loads.

## 25. Not verified by developer

PostHog project settings, Live Events, real Network payload, staging/production
deployment, production smoke, privacy smoke against the external service, and
dashboard results.

## 26. Expected results

Valid source events are accepted; unknown/unsafe data is rejected; missing,
disabled, invalid, expired, unsupported, SDK-blocked, and network-failed states
are no-op; AI Advisor behavior remains independent of analytics.

## 27. Developer technical checks

The final task report records exact commands and exit codes. The direct full
suite completed with 253 tests and exit code 0. After explicit user
authorization, the Agent OS command timeout was raised from 120 to 180 seconds
and its Pester contract was updated. The canonical `frontend-full` verification
then completed 253 tests in 97.978 seconds with exit code 0 and status `PASSED`.

## 28. Independent-test status

An independent `bug_hunter` tester reviewed the current source/diff and ran the
focused pilot suites after the actual-SDK `before_send` correction:

- source-only result: `PASSED`;
- Critical/High findings: none;
- explicitly not verified: external Network payload, PostHog Live Events and
  project settings, storefront CSP, consent decision, real token/dates,
  staging, production, and production privacy smoke.

The package must not be called production-ready until the separately authorized
rollout checks below are completed.

## Rollout and rollback

Rollout remains sequential: source review, independent local testing, separately
authorized staging, privacy/Network/Live Events checks, disabled production
deployment, explicit enablement, synthetic smoke, then pilot start.

Rollback is `AI_ADVISOR_ANALYTICS_ENABLED=false` followed by the runtime's
normal controlled restart. It must stop new analytics without rolling back chat,
product navigation, or order-status functionality.

## Staging runtime bootstrap

The staging API must use a separate runtime root, Windows task names, port, and
DPAPI-protected secret store. The task tools now support this without changing
the production defaults:

```powershell
# Run only from the isolated staging runtime root, in an elevated PowerShell.
$secretStore = 'C:\ProgramData\AI Advisor Staging\secrets\system-secrets.dpapi'
.\scripts\set-system-secret-store.ps1 -Initialize -Path $secretStore -Set AI_PROVIDER,HOST,ALLOWED_ORIGINS,OPENAI_API_KEY,STORE_URL,SALESDRIVE_SUBDOMAIN,SALESDRIVE_API_KEY,SALESDRIVE_YML_URL,TELEGRAM_ORDER_ENABLED,AI_ADVISOR_ANALYTICS_ENABLED,AI_ADVISOR_ANALYTICS_PROVIDER,AI_ADVISOR_ANALYTICS_ENVIRONMENT,POSTHOG_PROJECT_TOKEN,POSTHOG_API_HOST,AI_ADVISOR_ANALYTICS_PILOT_START,AI_ADVISOR_ANALYTICS_PILOT_END,AI_ADVISOR_ANALYTICS_SCHEMA_VERSION,AI_ADVISOR_WIDGET_VERSION
.\scripts\install-local-host-tasks.ps1 -Port 18788 -InstanceName 'AI Advisor Staging' -SecretStorePath $secretStore
```

Enter values only in the protected prompts. Keep `TELEGRAM_ORDER_ENABLED=false`.
Use the normal safe storefront origins (`https://ledprojector.com.ua` and
`https://www.ledprojector.com.ua`) because the existing `/dev/` storefront has
the same browser origin. Leave `AI_ADVISOR_ANALYTICS_ENABLED=false` until the
PostHog settings, token, exact 30-day window, and external privacy smoke all
pass. The Cloudflare public hostname must route only to
`http://localhost:18788` after the staging task reports healthy.
