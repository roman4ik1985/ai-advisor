# AI Advisor P4 Operations Acceptance

Date: 2026-07-29

Scope: source-only C40-C45. Active runtime, environment files, secrets, customer/order data, OpenCart/cPanel, Tunnel and external services were not changed.

## C40. Privacy-safe product analytics

- Analytics is disabled by default and requires explicit `PRODUCT_ANALYTICS_ENABLED`.
- The allow-list contains only `PRODUCT_CARD_SHOWN`, `PRODUCT_CARD_OPENED` and `PRODUCT_GUIDE_USED`.
- A record contains only event type, safe product key, schema metadata and timestamp.
- IP address, cookies, session/user identifiers, user agent, contact data, questions and answers are rejected by contract.
- Retention is 30 days; the rotation command drops expired, corrupt and unknown records.

## C41. Readiness and SLO

- `/health` remains the liveness endpoint.
- `/ready` evaluates lifecycle, provider configuration, queue capacity, rate-limit strategy and the optional Telegram dependency.
- The 30-day source SLO contract targets 99.5% availability, 98% successful responses and p95 latency at or below 15 seconds.
- A breach requires `FREEZE_ROLLOUT_AND_REVIEW_ERROR_BUDGET`.
- No production sample set was used in this source package, therefore the current CLI result is honestly `NO_DATA`.

## C42. Rate-limit strategy

- The current one-instance deployment uses the existing local fixed-window limiter.
- `BACKEND_INSTANCE_COUNT > 1` fails startup while no atomic distributed limiter is configured.
- No distributed acceptance is claimed and no Redis credential is required by P4.

## C43. Security maintenance

- `npm audit` reports zero vulnerabilities.
- The tracked-source marker scan reports zero files containing the selected API-key/token patterns.
- Required source headers are present: Content-Security-Policy, X-Content-Type-Options and Referrer-Policy.
- The maintenance gate is PASS with a 30-day review cadence.
- Details: [ai-advisor-security-maintenance-report.md](./ai-advisor-security-maintenance-report.md).

## C44. Cost/quality benchmark

- The deterministic RU/UK corpus contains 12 stable scenarios.
- Expected intent, route and resolver selection pass 12/12.
- The bounded model-call budget is 12 total and 1.0 average per scenario.
- A routing regression or budget overrun fails the command.

## C45. Performance budget

- `public/widget.js`: 30,567 bytes against a 120,000-byte budget.
- `public/widget.css`: 9,098 bytes against a 50,000-byte budget.
- Source asset budget: PASS.
- Staging thresholds are LCP <= 2,500 ms, CLS <= 0.1 and INP <= 200 ms.
- Real Web Vitals acceptance remains `STAGING_REQUIRED`; no synthetic value is substituted.
- Details: [ai-advisor-performance-budget-report.md](./ai-advisor-performance-budget-report.md).

## Commands

```powershell
npm run analytics:rotate
npm run slo:check
npm run security:maintenance
npm run benchmark:quality
npm run performance:budget
npm test
```

