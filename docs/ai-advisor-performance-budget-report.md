# AI Advisor Performance Budget Report

Date: 2026-07-29

## Source assets

| Asset | Measured | Budget | Result |
|---|---:|---:|---|
| `public/widget.js` | 30,567 bytes | 120,000 bytes | PASS |
| `public/widget.css` | 9,098 bytes | 50,000 bytes | PASS |

## Staging Web Vitals

| Metric | Budget | Current acceptance |
|---|---:|---|
| LCP | <= 2,500 ms | STAGING_REQUIRED |
| CLS | <= 0.1 | STAGING_REQUIRED |
| INP | <= 200 ms | STAGING_REQUIRED |

P4 does not invent laboratory or production measurements. Asset budgets are enforceable in source now; Web Vitals require an authorized staging installation and representative browser traffic.

Run the source gate:

```powershell
npm run performance:budget
```

