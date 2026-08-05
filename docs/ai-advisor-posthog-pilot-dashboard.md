# AI Advisor PostHog 30-day pilot dashboard specification

Status: source specification only. The PostHog project and dashboard have not
been created.

## Global filters

- Project: a dedicated `AI Advisor - 30-day pilot` project, preferably EU Cloud.
- Period: `AI_ADVISOR_ANALYTICS_PILOT_START` inclusive through
  `AI_ADVISOR_ANALYTICS_PILOT_END` exclusive.
- Include only `environment = production` and `traffic_type = real`.
- Exclude staging, test, development, and synthetic traffic.
- Show absolute counts beside every percentage.
- Conversion window: 30 minutes.
- Do not add person properties, URL/referrer filters, cohorts based on identity,
  session replay, or raw event inspection to product-facing tiles.

## Widget exposure

1. Unique anonymous `distinct_id` count for `widget_shown`.
2. Unique anonymous `distinct_id` count for `widget_opened`.
3. Funnel `widget_shown -> widget_opened`, unique by `distinct_id`.
4. Formula: unique opened / unique shown.
5. Daily trend for shown, opened, and open rate.

The server-proxied adapter maps one random in-memory widget lifecycle UUID to
PostHog `distinct_id`. It is not persisted across page loads and is never
identified or aliased.

## Questions and answers

1. Counts of `question_submitted`, `answer_completed`, and `answer_failed`.
2. Funnel `question_submitted -> answer_completed`, unique by
   `interaction_id`.
3. Success rate: completed interaction IDs / submitted interaction IDs.
4. Failure rate: failed interaction IDs / submitted interaction IDs.
5. Breakdown of failures by `error_type` and `error_stage`.
6. Timeout count where `error_type = timeout`.
7. Retry comparison by `was_retried`.
8. `response_time_ms` p50, p75, and p90 for completed answers.

Current UI retries are manual and therefore create a new interaction with
`was_retried = true`. There is no automatic retry whose intermediate failure
must be suppressed.

## Post-answer actions

1. Funnel `answer_completed -> product_opened`, joined by `interaction_id`.
2. Conversion to product: product-open interaction IDs / completed interaction
   IDs.
3. Time from completion to product open, capped at 30 minutes.
4. Breakdowns by `recommendation_position_bucket` and `open_target`.

`order_handoff_started` is included in the schema, but no dashboard tile may be
enabled until the product owner identifies a real pre-PII purchase handoff in
the widget. The existing Telegram form is an order-status verification flow,
not a purchase handoff.

## Optional feedback

Create these tiles only if a boolean-only feedback control is later approved:

- feedback count;
- helpful count;
- not-helpful count;
- helpful rate;
- completed answers with feedback / completed answers.

No text feedback field is permitted.
