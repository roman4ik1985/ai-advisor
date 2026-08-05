# AI Advisor PostHog 30-day decision memo

## Pilot identity

- Start (UTC date):
- End (UTC date, exclusive):
- PostHog region/project:
- Source commit:
- Runtime release:
- Decision owner:

## Data-quality statement

- Production real events:
- Synthetic/staging/test exclusions confirmed:
- Known gaps:
- Privacy or schema incidents:

## Product questions

| Question | Absolute values | Rate/percentile | Decision affected |
|---|---:|---:|---|
| Shown users who opened | | | |
| Submitted questions completed | | | |
| Submitted questions failed | | | |
| Completed answers leading to product open | | | |
| Completed answers leading to purchase handoff | N/A until valid lifecycle exists | N/A | |
| Latency p50/p75/p90 | | | |

## Decision

Choose one:

- disable and remove the pilot;
- retain only a smaller proven event subset;
- extend through a separately approved configuration change;
- promote a proven minimum into the long-lived product contract.

Reason:

## Privacy and cost review

- No session replay/autocapture/person profiles:
- No text, PII, URL, order, SalesDrive, or raw-error fields:
- Event volume and cost:
- Any incident and remediation:

## Follow-up

- Owner:
- Due date:
- Required source/config/runtime change:
- Rollback or data-deletion action:
