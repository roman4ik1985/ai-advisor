# AI Advisor Aiven Valkey 9.1 readiness

## Decision

Aiven for Valkey 9.1 is the managed target for the current local Windows
runtime. It provides a public TLS endpoint without adding an AWS VPC
VPN/tunnel dependency. AWS ElastiCache 9.1 remains technically compatible but
is not reachable from the current runtime without a separately authorized
network contour.

The source-only deployment package is in `infra/aiven/`. It pins Valkey 9.1,
requires TLS, enables RDB persistence and frequent snapshots, uses
`noeviction`, enables service logs, prevents deletion, narrows ingress to
explicit runtime egress CIDRs and creates a restricted application ACL user.
Secrets and connection URIs are neither committed nor emitted as Terraform
outputs.

## Current state

- Provider/version research: PASS.
- Aiven public TLS architecture: PASS.
- Terraform readiness contract: PASS.
- Aiven account authorization: BLOCKED — neither available browser had an
  authenticated Aiven session.
- Free managed service creation: NOT STARTED.
- Live TLS/command/Lua/concurrency/RDB smoke: NOT STARTED.
- Two-node primary/replica failover: NOT STARTED; requires a paid Business plan.
- Telegram menu-only test-bot: NOT STARTED.
- `TELEGRAM_ORDER_ENABLED`: remains false.
- Active runtime, `.env`, Telegram credentials/webhook values, SalesDrive
  payloads and customer/order data: untouched.

## Plan boundary

The Aiven free tier is one node, requires no credit card and includes backups,
metrics and logs. It can close managed TLS, command, Lua, concurrency and RDB
compatibility. It cannot prove automatic failover or satisfy a production HA
claim.

A two-node Business plan is required for failover acceptance. Aiven's current
public calculator shows an illustrative two-node Business-4 Valkey estimate of
about USD 110/month, but the exact project/cloud/region price must be reviewed
in the account before purchase.

## Operator continuation

1. Sign in to or create an Aiven account. Creating an account transmits the
   operator email to Aiven and must be explicitly authorized.
2. Create or select an Aiven project.
3. For no-cost compatibility evidence, create the free Valkey service and
   select Valkey 9.1. For production HA, first approve the exact paid plan.
4. Obtain the exact runtime egress CIDR and configure the service IP filter.
5. Supply the app password only through `TF_VAR_valkey_app_password`; supply
   the Aiven API token only through `AIVEN_TOKEN`.
6. Run `terraform plan`, review it, then explicitly approve `terraform apply`.
7. Put the temporary managed connection URI only in
   `VALKEY_AIVEN_TEST_URL` and run `npm run valkey:aiven:smoke`.
8. Verify backup evidence. On the paid HA plan, trigger and observe a managed
   primary/replica failover while the synthetic concurrency/outbox smoke runs.
9. Only after datastore acceptance, separately configure the server-side
   runtime variables and run the menu-only AI-free Telegram test-bot.
10. Keep `TELEGRAM_ORDER_ENABLED=false` until a separate production activation
    command.

The live smoke uses only synthetic keys under `aiadvisor:accept:*`, sends no
Telegram or SalesDrive request and removes its fixed test keys before exit.

