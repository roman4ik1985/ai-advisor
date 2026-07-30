# AI Advisor Valkey 9.1.1 WSL acceptance

Date: 2026-07-30

## Outcome

**PASS** for the bounded local compatibility contour.

Valkey 9.1.1 was installed user-locally in Ubuntu WSL2 and passed the real AI
Advisor Telegram datastore command, Lua, concurrency, persistence and outage
checks. Telegram remained disabled throughout the run.

This is development evidence only. It does not approve WSL as a production
datastore, prove replica failover, inspect Telegram credentials, or authorize
production activation.

## Installation

- Platform: Ubuntu 26.04 LTS under WSL2, x86_64.
- Artifact: official `valkey-9.1.1-noble-x86_64.tar.gz`.
- Source:
  <https://download.valkey.io/releases/valkey-9.1.1-noble-x86_64.tar.gz>
- Published SHA-256:
  `41f5eb5dc88111c5d117821c120c5a9fbcf2bcc3316953f811c04444046ecb28`
- Verified downloaded SHA-256: identical.
- Install path: `/home/roman/.local/opt/valkey-9.1.1`.
- Server version:
  `Valkey server v=9.1.1 sha=d27f9ba6:0 malloc=jemalloc-5.3.0 bits=64`.

No apt package, system service, PATH entry, Windows service or Docker
dependency was added.

## Reproducible command

From `C:\AI Advisor`:

```powershell
npm run valkey:acceptance
```

The runner:

1. refuses a pre-existing listener on its test port;
2. starts an isolated Valkey 9.1.1 instance bound to WSL loopback;
3. uses a unique `/tmp/ai-advisor-valkey-acceptance-*` data directory;
4. enables AOF with `appendfsync always` and RDB;
5. runs only synthetic AI Advisor datastore operations;
6. performs clean restart and forced `kill -9` recovery;
7. proves fail-closed behavior while the listener is unavailable;
8. stops the server and removes the guarded temporary data directory.

The smoke script rejects non-loopback endpoints, credentials in the URL and
non-Redis schemes. It never invokes Telegram, SalesDrive, OpenAI or the active
runtime.

## Acceptance matrix

| Gate | Evidence | Result |
| --- | --- | --- |
| Server identity | `INFO SERVER` reports Valkey 9.1.1 | PASS |
| Node client | locked project `redis` 6.1.0 client connects | PASS |
| Native string contract | `SET NX PX`, `PTTL`, `GETDEL` | PASS |
| Binding transaction | real three-key Lua binding script | PASS |
| Update deduplication | 16 concurrent claims, exactly one accepted | PASS |
| One-time order choice | 8 concurrent consumes, exactly one accepted | PASS |
| One-time lookup grant | 8 concurrent consumes, exactly one accepted | PASS |
| Distributed limiter | 4 concurrent calls at limit 3: 3 allow, 1 deny | PASS |
| Outbox | atomic enqueue deduplication, claim and acknowledge | PASS |
| Clean restart | persistence marker recovered | PASS |
| AOF | enabled, last write status `ok` | PASS |
| RDB | explicit save and last background-save status `ok` | PASS |
| Forced stop | marker recovered after `kill -9` and restart | PASS |
| Outage | connection refused; limiter denies; outbox unavailable | PASS |
| Cleanup | no listener, process or acceptance data directory remains | PASS |
| Feature boundary | `TELEGRAM_ORDER_ENABLED` not read or changed | PASS |

## Exact observed result

```json
{
  "status": "PASS",
  "server": "Valkey 9.1.1",
  "endpoint": "loopback:16391",
  "persistence": "AOF appendfsync always + RDB",
  "nativeCommands": "PASS",
  "luaAtomicity": "PASS",
  "concurrency": "PASS",
  "outboxDeduplication": "PASS",
  "cleanRestart": "PASS",
  "outage": {
    "connectionRefused": true,
    "rateLimiter": "DENY",
    "outbox": "UNAVAILABLE"
  },
  "forcedStopRecovery": "PASS",
  "telegramEnabled": false
}
```

## Remaining production gates

The following are intentionally not covered by this local contour:

- select a production Linux or managed Valkey 9.1.x target;
- provision a stable single-primary/single-shard `rediss://` endpoint;
- enable TLS certificate validation and a least-privilege ACL identity;
- configure encrypted off-host backup and monitoring;
- prove real primary/replica failover without split writes or lost
  acknowledged state beyond the approved RPO;
- check only the presence, never the values, of the server-side Telegram and
  webhook configuration;
- provide `TELEGRAM_ORDER_REDIS_URL` and
  `TELEGRAM_ORDER_MANAGER_CHAT_ID`;
- run the Telegram test-bot and separately authorized synthetic SalesDrive
  acceptance;
- authorize production enablement as a distinct final contour.

KeyDB active-active, Valkey Cluster and WSL production use remain prohibited for
the current multi-key Lua contract.

## Files

- `scripts/run-valkey-wsl-acceptance.ps1`
- `scripts/valkey-compatibility-smoke.mjs`
- `package.json`
- `docs/ai-advisor-redis-valkey-keydb-evaluation.md`
