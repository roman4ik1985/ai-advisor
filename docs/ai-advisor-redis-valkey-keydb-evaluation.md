# AI Advisor Redis / Valkey / KeyDB evaluation

Reviewed at: 2026-07-30

## Decision

Use **Valkey 9.1.x on a Linux-based, single-primary/single-shard deployment**
as the preferred datastore for the disabled Telegram order contour. The current
patch release at review time is 9.1.1.

Keep **Redis 8.x** as the supported fallback when Redis vendor support or an
existing managed Redis service is operationally more valuable than Valkey's
BSD-3-Clause governance.

Do **not** select KeyDB for the new production deployment. It is protocol
compatible with the current application, but its latest release is from 2023
and its repository has not received a source push since 2024. Its active-active
and multi-master modes also conflict with AI Advisor's single-use tokens,
deduplication, rate limiting and atomic outbox requirements.

This decision does not activate Telegram, provision a datastore, modify
configuration, or authorize a runtime release.

## AI Advisor datastore contract

The current source uses the locked `redis` 6.1.0 Node client and accepts only a
`redis://` or `rediss://` connection URL.

Required server behavior:

- RESP client compatibility;
- strings with `SET NX PX`, `GET`, `GETDEL` and `DEL`;
- expiry with `PEXPIRE` and `PTTL`;
- counters with `INCR`;
- hashes with `HSET`, `HGET` and `HINCRBY`;
- sorted sets with `ZADD`, `ZRANGEBYSCORE` and `ZREM`;
- atomic Lua 5.1 `EVAL` scripts;
- persistence suitable for binding state and an at-least-once outbound outbox;
- fail-closed behavior when the datastore is unavailable.

The source uses multi-key scripts without Redis Cluster hash tags. The outbox
claim script also derives a record key inside Lua from a key prefix. Therefore:

- standalone or a single-shard primary/replica service is compatible;
- Redis/Valkey Cluster is not compatible without a separate key-slot redesign;
- active-active or multi-master writes are prohibited;
- all application writes must resolve to one authoritative primary.

Relevant source:

- `package.json`
- `telegram-order-redis-client.mjs`
- `telegram-order-redis-store.mjs`
- `telegram-order-redis-rate-limit.mjs`
- `telegram-order-outbox.mjs`
- `telegram-order-runtime.mjs`

## Comparison

| Criterion | Redis | Valkey | KeyDB |
| --- | --- | --- | --- |
| Current release at review | 8.10.0, 2026-07-29 | 9.1.1, 2026-07-21 | 6.3.4, 2023-10-30 |
| Repository activity | Active; pushed 2026-07-30 | Active; pushed 2026-07-30 | Last source push 2024-05-29 |
| License | Redis 8 tri-license: RSALv2, SSPLv1 or AGPLv3 | BSD-3-Clause | BSD-3-Clause |
| Existing `redis` Node client | Native target | Existing Redis clients work over RESP without code changes | Declared Redis API/protocol/client compatibility |
| Required commands and Lua | Supported | `GETDEL`, `SET NX PX`, sorted sets and atomic Lua supported | Declared compatibility with Redis commands, scripts and transactions |
| Persistence | RDB, AOF, or both | RDB, AOF, or both | RDB, AOF, or both |
| TLS | Supported | Supported, including replication/Sentinel TLS | TLS build enabled by default in official source |
| HA model acceptable here | Single primary with Sentinel or managed stable endpoint | Single primary with Sentinel or managed stable endpoint | Only single-writer primary/replica; no multi-master |
| Windows production | Official guidance uses Docker on Windows | No native Windows support; WSL is development-only | Built and tested for Linux |
| Maintenance risk | Low | Low | High |
| AI Advisor decision | Supported fallback | **Preferred** | Do not adopt for production |

## Why Valkey is preferred

1. It supports the exact protocol and command surface used by AI Advisor.
2. Existing Redis client libraries can connect without a code change.
3. Valkey 9.1 has published maintenance support through 2029-05-19 and security
   support through 2031-05-19.
4. It is actively released and governed as a vendor-neutral BSD-3-Clause
   project.
5. It provides the required TLS, ACL, persistence and single-primary HA
   building blocks without introducing KeyDB-specific replication semantics.

The preferred version is the latest 9.1.x patch, not an unpinned `latest` image.
Valkey 9.1 moves Lua into a module, so the selected package or managed service
must explicitly expose `EVAL`; this is a mandatory pre-activation check.

## Deployment contract

The production candidate must satisfy all of the following:

- Linux-based managed service or production Linux host/container; do not make
  WSL or Docker Desktop on the Windows AI Advisor host a production dependency;
- one stable `rediss://` endpoint that always routes writes to the authoritative
  primary;
- certificate validation, ACL authentication and a dedicated least-privilege
  application identity;
- network access restricted to the AI Advisor runtime;
- persistence with RDB snapshots plus AOF;
- for the low-volume Telegram outbox, evaluate `appendfsync always`; if
  `appendfsync everysec` is selected instead, explicitly accept an RPO of up to
  approximately one second during host failure;
- memory policy that does not evict binding, proof, rate-limit or outbox keys;
- encrypted off-host backups and a tested restore;
- monitoring for availability, memory, evictions, persistence errors,
  replication lag and certificate expiry.

The current client accepts a fixed URL and does not discover Sentinel topology.
Self-hosted Sentinel therefore requires either a stable proxy/VIP/DNS endpoint
or a separately approved client change. A managed stable endpoint is the
narrower integration path.

## Mandatory acceptance gates

Keep `TELEGRAM_ORDER_ENABLED=false` throughout these gates.

1. **Protocol gate**
   - connect over TLS with the production client package;
   - verify authentication without logging the URL or credentials;
   - verify every command in the datastore contract.
2. **Atomicity gate**
   - run concurrent update deduplication and fixed-window rate-limit tests;
   - run binding completion, notification toggle and one-time `GETDEL`
     consumption under contention;
   - verify all outbox enqueue, claim, acknowledge and dead-letter Lua scripts.
3. **Persistence gate**
   - enqueue synthetic non-customer records;
   - restart the datastore cleanly and after a forced process stop;
   - verify binding, TTL and outbox recovery against the approved RPO.
4. **Failover gate**
   - interrupt the primary during concurrent synthetic operations;
   - prove that writes never split across primaries;
   - verify the application fails closed while unavailable and reconnects to
     the new authoritative primary;
   - verify no duplicate one-time grants and no silently lost acknowledged
     outbox item within the approved RPO.
5. **Security and release gate**
   - confirm ACL command categories cover only the required command set;
   - confirm no anonymous order lookup and no free-text Telegram handling;
   - run the Telegram test-bot and authorized synthetic SalesDrive acceptance
     as distinct later contours;
   - authorize production enablement separately.

## Rejected shortcuts

- KeyDB active-replica or multi-master behind a write load balancer;
- Redis/Valkey Cluster without redesigning every Lua key into one declared hash
  slot and eliminating dynamically derived script keys;
- unencrypted public datastore endpoints;
- cache-style eviction policies that can silently evict application state;
- declaring compatibility from unit-test adapters alone;
- enabling the Telegram feature before real concurrency, persistence and
  failover acceptance.

## Sources

- Redis releases and repository:
  <https://github.com/redis/redis/releases/tag/8.10.0>,
  <https://api.github.com/repos/redis/redis>
- Redis licensing:
  <https://redis.io/legal/licenses/>
- Redis persistence and Sentinel:
  <https://redis.io/docs/latest/operate/oss_and_stack/management/persistence/>,
  <https://redis.io/docs/latest/operate/oss_and_stack/management/sentinel/>
- Redis installation on Windows:
  <https://redis.io/docs/latest/operate/oss_and_stack/install/install-stack/>
- Valkey release and support policy:
  <https://valkey.io/download/>,
  <https://valkey.io/topics/releases/>,
  <https://api.github.com/repos/valkey-io/valkey>
- Valkey migration/client compatibility:
  <https://valkey.io/topics/migration/>
- Valkey commands and scripting:
  <https://valkey.io/commands/getdel/>,
  <https://valkey.io/commands/set/>,
  <https://valkey.io/topics/eval-intro/>
- Valkey persistence, TLS, Sentinel and installation:
  <https://valkey.io/topics/persistence/>,
  <https://valkey.io/topics/encryption/>,
  <https://valkey.io/topics/sentinel/>,
  <https://valkey.io/topics/installation/>
- KeyDB compatibility, repository and persistence:
  <https://docs.keydb.dev/docs/compatibility/>,
  <https://github.com/Snapchat/KeyDB>,
  <https://api.github.com/repos/Snapchat/KeyDB>,
  <https://docs.keydb.dev/docs/persistence/>
- KeyDB replication and multi-master semantics:
  <https://docs.keydb.dev/docs/replication/>,
  <https://docs.keydb.dev/docs/multi-master/>
