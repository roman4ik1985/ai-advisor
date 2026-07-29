# AI Advisor Security Maintenance Report

Date: 2026-07-29

Scope: source-only maintenance gate. The check does not print secret values and did not inspect or change runtime environment files.

| Check | Result |
|---|---|
| `npm audit --json` | PASS, 0 vulnerabilities |
| Tracked-source API-key/token marker filenames | PASS, 0 files |
| `Content-Security-Policy` | PASS |
| `X-Content-Type-Options` | PASS |
| `Referrer-Policy` | PASS |
| Release gate | PASS |
| Next scheduled review | Within 30 days |

Any HIGH or CRITICAL dependency finding, tracked secret marker or missing required security header blocks release. The scan is intentionally narrow and repeatable; it is not a substitute for staging penetration testing or infrastructure review.

Run:

```powershell
npm run security:maintenance
```

