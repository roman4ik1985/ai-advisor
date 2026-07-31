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
- Aiven account authorization: PASS.
- Aiven organization/project creation: PASS — organization `My Organization`,
  project `ai-advisor`.
- Free managed service creation: PASS — service `ai-advisor-valkey`, Valkey
  9.1, Free-1, one CPU, 1 GB RAM, DigitalOcean Amsterdam; the creation summary
  showed `Free` before submission.
- Network restriction: INCOMPLETE — the service was created with the free-tier
  default `0.0.0.0/0` and `::/0`; replace both with the current trusted egress
  CIDR. The live smoke subsequently connected from the current egress, but the
  final allowlist contents still require an independent UI check.
- Live TLS/command/Lua/concurrency/RDB smoke: PASS — the process-scoped
  credential connected over TLS to Valkey 9.1.x; native SET NX PX/GETDEL, Lua,
  16-way concurrency and durable outbox deduplication passed. Fixed synthetic
  keys were deleted and the process variable plus clipboard were cleared.
- Managed backup evidence: PENDING — the initial backup started during service
  creation, but the completed backup record was not independently read because
  browser control became unavailable.
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

### Secure continuation after service creation

1. In the Aiven service overview, set the IP allowlist to only the current
   trusted egress IPv4 address with a `/32` suffix; remove both open-to-all
   defaults.
2. After the service reports `Running`, copy the full `rediss://` service URI
   to the local clipboard without pasting it into chat or a file.
3. Load the clipboard into the process-scoped `VALKEY_AIVEN_TEST_URL` variable
   and run `npm run valkey:aiven:smoke`.
4. Clear the variable from the process and verify that the fixed synthetic
   keys were removed.
5. Verify the initial backup in Aiven before marking the free datastore
   acceptance complete.

Live acceptance executed on 2026-07-31:

```json
{"status":"PASS","mode":"live","provider":"aiven","engine":"valkey","version":"9.1.x","tls":true,"nativeCommands":"PASS","luaAtomicity":"PASS","concurrency":"PASS","outboxDeduplication":"PASS","telegramEnabled":false}
```

## Zero-paid-plan decision (2026-07-31)

Paid Valkey/Redis plans are excluded. A current vendor comparison found no
mature managed free tier that provides both a primary and replica with
automatic failover:

| Option | Free replication / HA | Project compatibility | Decision |
| --- | --- | --- | --- |
| Aiven Valkey | No; free tier is one node | Valkey 9.1, TLS, Lua and RDB fit | Keep only for managed single-node acceptance |
| Upstash Redis | No; replication is enabled for paid databases and Prod Pack is unavailable on Free | Required commands/Lua are broadly available | Reject as free HA |
| Redis Cloud | No; free Essentials explicitly excludes replication | Protocol-compatible but not Valkey 9.1 | Reject as free HA |
| Clever Cloud Materia KV | Three-datacenter synchronous replication is free during alpha | No `EVAL`, `GETDEL`, sorted sets or full Redis API; vendor forbids production-grade data | Reject |
| Oracle Cloud Always Free compute | Enough free VM capacity for a self-managed primary, replica and a third Sentinel voter | Can run official Valkey 9.1 with TLS, ACL, AOF/RDB and Sentinel | Only viable zero-infrastructure-charge HA candidate |

Oracle is not a managed datastore. It requires account verification (normally
phone and payment card), Linux administration, patching, monitoring, backups,
TLS/ACL rotation and a tested Sentinel failover runbook. Free capacity can be
temporarily unavailable in the selected home region, idle accounts can be
suspended, and there is no paid production SLA/support. Two Valkey data nodes
alone are not a safe quorum design; use three Sentinel voters across three
Always Free VMs.

### What the three Oracle VMs mean

Oracle supplies general-purpose compute, network and block storage rather than
a managed Valkey service. The minimum robust Sentinel layout is:

- VM 1: Valkey primary plus Sentinel 1;
- VM 2: Valkey replica plus Sentinel 2;
- VM 3: Sentinel 3 as the independent quorum voter; it can be small and does
  not need to hold a third data copy.

The Sentinel quorum is 2 of 3. If VM 1 fails, Sentinel 2 and Sentinel 3 can
agree that the primary is unavailable and promote the replica on VM 2. With
only two machines, loss of the primary machine also removes one voter and
leaves no safe majority. Allowing the remaining voter to promote alone during
a network partition could create two writable primaries (split brain). The
third VM is therefore mainly an independent arbitrator, not extra capacity.

Self-management also makes this project responsible for OS and Valkey
installation/upgrades, firewall rules, TLS certificates, ACL credentials,
monitoring and alerts, backup/restore drills, Sentinel failover tests and
incident response. Oracle free capacity can be unavailable, eligible idle
instances can be reclaimed, and infrastructure maintenance can still reboot a
VM when live migration is not possible. Sentinel replication is asynchronous,
so acknowledged writes can be lost during some failures.

The current Node Redis integration is configured through one connection URL
and does not implement Sentinel discovery. Using this topology would therefore
require a separate application/client change or an additional proxy endpoint,
plus secure connectivity from the Windows runtime to the Oracle VMs. For the
current low-volume pilot, this operational and application complexity
outweighs the availability benefit; managed single-node Aiven remains the
recommended zero-paid-plan starting point.

Sources:

- <https://aiven.io/docs/products/valkey/concepts/valkey-free-tier>
- <https://upstash.com/docs/redis/features/replication>
- <https://upstash.com/pricing/redis>
- <https://redis.io/docs/latest/operate/rc/databases/configuration/high-availability/>
- <https://www.clever-cloud.com/developers/doc/addons/materia-kv/>
- <https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm>
- <https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier.htm>
- <https://docs.oracle.com/en-us/iaas/Content/Compute/References/infrastructure-maintenance.htm>
- <https://valkey.io/topics/sentinel/>

## Low-volume availability decision (2026-07-31)

At the current average of five store orders per day, with only a fraction of
customers expected to use Telegram order status, a second Valkey node is a
`should-have`, not a launch `must-have`.

If 10–30% of orders use Telegram, the expected volume is approximately
0.5–1.5 users per day. Under a simplified uniform-arrival model, a random
one-hour Valkey outage would overlap approximately 0.02–0.06 initial Telegram
uses on average; a full-day outage would affect approximately 0.5–1.5 users.
Actual impact can be higher when requests cluster after shipping notifications,
so this is capacity framing rather than an uptime prediction.

The standby node protects primarily against loss of the primary process,
virtual machine, hardware or maintenance replacement. It does not protect
against every failure:

- local AI Advisor runtime or Internet outage;
- provider-wide, regional, DNS or TLS failure;
- free-tier inactivity power-off or account suspension;
- an expired credential, wrong ACL, IP filter or application configuration;
- logical corruption, accidental deletion or a software bug replicated to the
  standby;
- loss of both nodes or data written after the last usable backup.

Aiven documents that single-node services automatically restart minor process
failures. If the whole node is lost, Aiven creates a replacement and restores
the latest backup, but the service is unavailable during recovery and writes
after that backup can be lost. Free services have no 99.99% SLA and may be
powered off after non-continuative activity with notice.

### Initial reliability target

- Classification: single-node managed Valkey is accepted for the current
  low-volume pilot.
- Internal availability SLO: 99.0% per calendar month, measured by a synthetic
  TLS `PING` plus a harmless scoped write/read check. This is an internal target,
  not an Aiven free-tier SLA.
- Error budget: approximately 7 hours 18 minutes of unavailability per month.
- Detection target: probe every 5 minutes and alert after two consecutive
  failures, for a maximum nominal detection delay of 10 minutes.
- Recovery target: restore service within 4 hours during operator availability
  and within 12 hours outside it.
- Data-loss target: not accepted until a real backup/restore drill measures the
  effective recovery point. SalesDrive remains the order source of truth;
  Valkey loss can require Telegram re-linking and can lose pending notification
  state, but cannot delete the underlying order.

Reconsider a second node when Telegram usage reaches roughly 30–50 status
actions per day, customers require continuous 24/7 status access, measured
single-node downtime exceeds the error budget, or the operational cost of an
incident exceeds the cost of HA.
