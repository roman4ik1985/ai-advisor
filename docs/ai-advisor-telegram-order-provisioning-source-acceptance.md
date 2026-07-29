# Telegram order-link provisioning source acceptance

Date: 2026-07-29
Status: source PASS; feature disabled and live release pending

## Implemented

- `salesdrive-order-provisioning.mjs` performs one GET-only SalesDrive
  `/api/order/list/` lookup using the documented top-level `externalId` field,
  exact response matching and `limit=2`.
- Only a unique order with a valid source ID, counterparty ID and normalized
  Ukrainian phone becomes an internal candidate.
- `telegram-order-provisioning.mjs` always creates a ten-minute opaque link.
  Existing orders store the candidate proof inputs; missing/invalid orders store
  a decoy customer reference, impossible phone and no source IDs.
- Real and decoy links have the same public code, fields, button label, URL shape
  and expiry. Both reach the same Telegram contact prompt; only the subsequent
  own-contact comparison can establish a binding.
- `POST /api/telegram/order-link` is fixed, CORS allow-listed, IP rate-limited
  and exists only when the disabled-by-default Telegram runtime is enabled.
- The widget has a separate order-number form and renders only a validated
  `https://t.me/<bot>?start=<opaque-token>` link through DOM APIs. The order
  number never enters the AI conversation.

## Public response

```json
{
  "code": "TELEGRAM_ORDER_LINK_READY",
  "button": {
    "text": "Перевірити замовлення в Telegram",
    "url": "https://t.me/<configured-bot>?start=<opaque-token>"
  },
  "expiresInSeconds": 600
}
```

No order existence, phone, customer reference, source ID, status or other order
fact is returned.

## Verification

- Focused provisioning/widget/security: 19/19 PASS.
- Full source suite: 174/174 PASS.
- Real/decoy public-shape parity, duplicates, missing phone, malformed input,
  GET-only behavior, PII exclusion, safe Telegram URL and no-AI separation pass.
- No `.env`, runtime, Redis, Telegram, SalesDrive customer/order payload,
  OpenCart/cPanel, Tunnel or remote was accessed or changed.

## Live prerequisites

- Configure `TELEGRAM_ORDER_BOT_USERNAME`, Redis, bot token and webhook secret.
- Add a durable outbound outbox and real manager/notification sinks.
- Run Telegram test-bot, Redis concurrency/failover and authorized synthetic
  SalesDrive acceptance.
- Perform a separately approved active-runtime release.
