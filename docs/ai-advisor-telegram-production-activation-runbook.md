# Telegram production activation runbook

Date: 2026-08-02
Status: documented only; activation blocked and `TELEGRAM_ORDER_ENABLED=false`

## Purpose

This runbook defines the only approved sequence for a future production
Telegram order-status activation. It does not authorize secret access,
SalesDrive customer/order requests, webhook mutation, runtime deployment or
feature enablement.

The production contour remains fixed-menu only, AI-free and fail-closed.
Anonymous lookup, typed-phone proof, free-text order lookup and cross-customer
order access are prohibited.

## Current accepted baseline

- The active Windows runtime and source `P3P4Runtime` profile have zero diff.
- Local and public health return HTTP 200.
- The free Aiven Valkey service is Running behind the trusted runtime `/32`;
  the open IPv4 and IPv6 ranges are absent.
- Isolated live acceptance passed TLS Valkey, signed and unauthorized webhook
  handling, update deduplication, distributed rate limiting, durable outbox
  delivery, fixed six-button Telegram delivery and Redis cleanup.
- The isolated run made zero SalesDrive requests, performed no free-text lookup
  and used no AI.

## Hard blockers before activation

1. **Protected secret loader is implemented in source but is not provisioned or
   released.** The approved launcher reads a DPAPI LocalMachine bundle from
   `%ProgramData%\AI Advisor\secrets\system-secrets.dpapi`, requires an
   inheritance-disabled ACL limited to `SYSTEM` and local Administrators, and
   injects allowlisted values only into the Node child environment. The bundle
   must be provisioned interactively from an elevated console and the source
   must pass the release gates before replacing the active runtime. Do not put
   production Telegram, Valkey or SalesDrive credentials in a repository file,
   command line, task XML, browser code, logs, chat messages or user/machine
   plaintext environment variables.
2. **SalesDrive production access is not accepted for this contour.** Enabling
   the runtime constructs the order client immediately and fails startup when
   SalesDrive is not configured. Any real or synthetic order acceptance needs
   separate authorization, an explicitly owned test order and payload-safe
   evidence.
3. **Webhook mutation is not authorized.** `setWebhook`, `deleteWebhook` and
   `drop_pending_updates` change external Telegram state and require a separate
   execute-now command after all local gates pass.
4. **Production activation is not authorized.** The final false-to-true feature
   flag transition is a distinct operation with its own rollback window.

The source implementation is `scripts/system-secret-store.ps1`, the hidden-input
operator helper is `scripts/set-system-secret-store.ps1`, and
`scripts/run-api-task.ps1` is the SYSTEM-only launcher. Provisioning, release and
activation remain separate protected operations. The default launcher rejects a
bundle with `TELEGRAM_ORDER_ENABLED=true`; enabling it requires a separately
authorized launcher flag as well as the later gates in this runbook.

The source release helper has a separate `SYSTEMSecretLoader` profile containing
only the two runtime scripts. Its dry-run is metadata-only. Its `-Apply` path
performs a local, boolean-only DPAPI readiness check and stops with a stable code
unless the protected bundle exists, its ACL and required runtime values validate,
and Telegram remains disabled. The bundle is neither provisioned nor decrypted by
the dry-run; `-Apply`, restart and any secret entry each need their own explicit
authorization.

Initial provisioning is performed only from an elevated interactive PowerShell
session. Values are entered through hidden `SecureString` prompts and are never
accepted as command-line values or an input file. The initial bundle must include
`AI_PROVIDER`, `OPENAI_API_KEY` and `TELEGRAM_ORDER_ENABLED`, with the provider set
to `api` and Telegram set to `false`. Example names-only invocation:

```powershell
.\scripts\set-system-secret-store.ps1 -Initialize -Set AI_PROVIDER,OPENAI_API_KEY,TELEGRAM_ORDER_ENABLED
```

Additional allowlisted values are added with another names-only invocation. The
helper returns only a stable status, store path, value count and Telegram boolean;
it never returns values. Do not use `-AllowTelegramEnabled` unless the distinct
production activation authorization has been granted.

## Required server-side values

Check presence and format only; never emit values:

- `TELEGRAM_ORDER_BOT_USERNAME`
- `TELEGRAM_ORDER_BOT_TOKEN`
- `TELEGRAM_ORDER_WEBHOOK_SECRET`
- `TELEGRAM_ORDER_REDIS_URL` using TLS (`rediss://`)
- `TELEGRAM_ORDER_MANAGER_CHAT_ID`
- `TELEGRAM_ORDER_RATE_LIMIT_PER_MINUTE` in the supported 1–60 range
- existing server-side SalesDrive configuration required by the exact-ID
  ownership client and provisioning resolver

`TELEGRAM_ORDER_ENABLED` must remain `false` throughout provisioning and every
pre-activation check.

## Pre-activation gates

All gates must pass in one bounded change window:

1. Confirm an ordinary committed source baseline, clean scoped release diff and
   healthy local/public `/health` plus local `/ready`.
2. Confirm the Aiven plan remains Free-1 and the allowlist contains only the
   freshly rechecked runtime egress `/32`; do not select a paid plan.
3. Run secret-presence validation that returns booleans or stable error codes
   only. Reject non-TLS Valkey URLs, missing webhook secrets and invalid bot or
   manager identifiers.
4. Repeat the isolated Telegram test-bot smoke with production disabled.
5. Run separately authorized SalesDrive acceptance using only an explicitly
   owned test order. Evidence must contain counts/status codes, never customer,
   order, phone, address, token or upstream payload values.
6. Verify the production bot has been started by the approved private manager
   chat and can perform a harmless outbound transport check.
7. Capture a hash-verified runtime rollback and verify that restoring the
   disabled configuration requires no DNS, Tunnel, cPanel or OpenCart change.

Any failed or unavailable dependency blocks activation.

## Webhook registration gate

The intended endpoint is:

```text
https://ai.ledprojector.com.ua/api/telegram/order-webhook
```

Telegram must be configured through an in-memory, secret-safe operator helper;
never place the bot token in shell history or a saved URL. The registration
must use:

- HTTPS with the existing trusted public certificate;
- the exact webhook URL above;
- `secret_token` equal to the server-side webhook secret so Telegram sends
  `X-Telegram-Bot-Api-Secret-Token` on each request;
- `allowed_updates` restricted to `message` and `callback_query`;
- no custom certificate upload for the existing trusted public endpoint.

Before registration, query `getWebhookInfo` without printing the request URL or
token. Do not set `drop_pending_updates=true` unless the operator separately
confirms that the pending queue contains only disposable pre-production test
updates. After registration, accept only a secret-safe result containing
success, the expected host/path, pending-update count and last-error presence.

Official Telegram references:

- <https://core.telegram.org/bots/api#setwebhook>
- <https://core.telegram.org/bots/webhooks>

## Activation and canary

Only after every gate passes and the operator explicitly authorizes activation:

1. Load approved secrets into the SYSTEM-launched Node child process through the
   protected loader.
2. Start once with `TELEGRAM_ORDER_ENABLED=false`; require health/readiness 200
   and zero unexpected source/runtime diff.
3. During the bounded canary window only, set `TELEGRAM_ORDER_ENABLED=true` and
   restart the API task through the approved activation script. Require
   local/public health and readiness before exposing the webhook.
4. Only after the enabled runtime is ready, register and verify the webhook.
5. Require signed webhook acceptance, one
   menu-only private canary and zero anonymous/free-text/AI behavior.
6. Inspect only bounded counters and stable error codes. Do not inspect or log
   customer/order payloads.

Do not register the webhook against the disabled route: it returns 404 and
Telegram may retry non-2xx delivery. Registration must occur only after the
enabled runtime passes readiness, inside the separately approved activation
window.

## Immediate rollback

Rollback is mandatory on failed readiness, Valkey/SalesDrive unavailability,
unexpected Telegram behavior, duplicate delivery growth or any secret exposure:

1. Restore `TELEGRAM_ORDER_ENABLED=false` through the protected launcher and
   restart the API task.
2. Require local/public health 200 and confirm both Telegram order endpoints
   are unavailable in the disabled state.
3. Remove or redirect the Telegram webhook only through a separately approved
   secret-safe helper. Do not use `drop_pending_updates` implicitly.
4. Preserve bounded error codes and counts only; rotate any credential that may
   have appeared in terminal history, logs, clipboard or chat.
5. Keep SalesDrive as the source of truth. Never attempt to reconstruct orders
   from Valkey state.

## Go/no-go decision

Current decision: **NO-GO**. The isolated transport evidence and protected loader
source are sufficient for their respective code gates, but the loader is not yet
provisioned or released and separately authorized SalesDrive acceptance does not
exist. Production remains disabled until those gates, webhook registration and
the final activation command are independently closed.
