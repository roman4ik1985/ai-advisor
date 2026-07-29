# AI Advisor P6 production monitoring

Date: 2026-07-29  
Agent OS task: `TASK-2026-07-29-140816-215`

## Result

P6 C60-C64 is a read-only post-production gate. It does not edit OpenCart,
Lightning, the active AI runtime, environment files, secrets, orders or customer
data.

Run:

```powershell
npm run production:smoke
```

The command exits with code 0 only when every HTTP, immutable-cache, browser,
interaction, Web Vitals and error gate passes.

## C60 immutable bundle integrity

The monitor reads five fixed `https://ledprojector.com.ua` routes and extracts
same-origin Lightning JavaScript URLs. It fetches every asset twice:

1. the normal immutable URL;
2. the same URL with a monitor-only cache-busting query.

Exactly one bundle must contain both `lp-agent-root` and the fixed production
API endpoint. Its normal and cache-busted byte length and SHA-256 hash must be
identical, and it must be at least 20,000 bytes. This catches the two-byte stale
bundle failure observed during P5 without treating unrelated storefront bundles
as widget failures.

## C61 route and mount smoke

The fixed route set is:

- homepage;
- `/proektory`;
- `/jenovox-m4000`;
- cart;
- checkout, including the expected SimpleCheckout redirect.

HTTP must return 200 and expose a Lightning script on every route. A temporary
headless Chrome or Edge profile then loads the same routes and requires exactly
one `.lp-agent-root` plus the widget loaded guard on each page.

The browser runner uses the installed Chrome DevTools Protocol directly and
adds no npm/browser-download dependency. A custom executable can be selected
with `--browser=<absolute path>` or `AI_ADVISOR_BROWSER_EXECUTABLE`.

## C62 mobile and Web Vitals gate

The browser repeats the homepage at 390x844 and verifies:

- one mounted widget;
- launcher opens the panel;
- focus enters `#lp-agent-input`;
- close returns focus to the launcher;
- LCP at or below 2,500 ms;
- CLS at or below 0.1;
- INP at or below 200 ms.

The PerformanceObserver is installed before navigation. The interaction is sent
through CDP as a trusted mouse action.

## C63 SLO and alert consequence

Any route, bundle, mount, focus, Web Vitals or browser-error violation returns
`FAIL`, exits non-zero and emits:

`FREEZE_ROLLOUT_AND_USE_ROLLBACK_RUNBOOK`

The operator must stop expansion and use the P5 rollback runbook. A passing run
emits `CONTINUE_MONITORING`.

Recommended cadence:

- immediately after an OpenCart Modifications or Lightning refresh;
- after a widget release;
- daily as an external read-only monitor;
- before declaring a production incident recovered.

## C64 live acceptance

Two consecutive production runs passed. The first run is retained as the
acceptance row below; the repeat run measured LCP 1,024 ms, CLS 0 and INP 48 ms.

| Gate | Evidence |
|---|---|
| HTTP routes | 5/5 PASS, HTTP 200 |
| Widget bundle | `141939397cs.js`, 29,472 bytes |
| Immutable parity | normal/cache-busted SHA-256 identical |
| Browser mount | 5/5 PASS |
| Mobile viewport | 390x844 |
| LCP | 1,268 ms |
| CLS | 0 |
| INP | 56 ms |
| Focus contract | PASS |
| Browser errors | 0 |
| Consequence | `CONTINUE_MONITORING` |

Focused P6 tests cover URL allow-listing, stale/partial bundle rejection,
unrelated bundle classification, full-pass assessment, freeze consequence,
DevTools endpoint parsing and browser acceptance contracts.
