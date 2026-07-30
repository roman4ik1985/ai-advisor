import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createClient } from 'redis';
import { createTelegramOrderOutbox } from '../telegram-order-outbox.mjs';
import { createTelegramOrderRedisClient } from '../telegram-order-redis-client.mjs';
import { createTelegramOrderRedisRateLimiter } from '../telegram-order-redis-rate-limit.mjs';
import { createTelegramOrderRedisStore } from '../telegram-order-redis-store.mjs';

const phase = String(process.argv[2] || '');
const url = requireLoopbackUrl(process.env.VALKEY_TEST_URL);
const prefix = normalizePrefix(process.env.VALKEY_TEST_PREFIX || 'aiadvisor:valkeyaccept');

const result = phase === 'compatibility'
  ? await runCompatibility()
  : phase === 'recovery'
    ? await runRecovery()
    : phase === 'outage'
      ? await runOutage()
      : null;

if (!result) {
  throw new Error('Usage: node scripts/valkey-compatibility-smoke.mjs <compatibility|recovery|outage>');
}

process.stdout.write(`${JSON.stringify(result)}\n`);

async function runCompatibility() {
  const redis = await createTelegramOrderRedisClient({ url });
  await redis.connect();
  try {
    const serverInfo = String(await redis.sendCommand(['INFO', 'SERVER']));
    assert.match(serverInfo, /^server_name:valkey\r?$/mu);
    assert.match(serverInfo, /^valkey_version:9\.1\.1\r?$/mu);

    const persistenceInfo = String(await redis.sendCommand(['INFO', 'PERSISTENCE']));
    assert.match(persistenceInfo, /^aof_enabled:1\r?$/mu);

    const nativeKey = `${prefix}:native:getdel`;
    assert.equal(await redis.sendCommand(['SET', nativeKey, 'first', 'NX', 'PX', '60000']), 'OK');
    assert.equal(await redis.sendCommand(['SET', nativeKey, 'second', 'NX', 'PX', '60000']), null);
    const nativeTtl = Number(await redis.sendCommand(['PTTL', nativeKey]));
    assert.ok(nativeTtl > 0 && nativeTtl <= 60_000);
    assert.equal(String(await redis.sendCommand(['GETDEL', nativeKey])), 'first');
    assert.equal(await redis.sendCommand(['GETDEL', nativeKey]), null);

    const now = Date.now();
    const store = createTelegramOrderRedisStore({
      sendCommand: redis.sendCommand,
      prefix: `${prefix}:state`,
      now: () => now,
      randomBytesFn: randomBytes,
    });
    const storePeer = createTelegramOrderRedisStore({
      sendCommand: redis.sendCommand,
      prefix: `${prefix}:state`,
      now: () => now,
      randomBytesFn: randomBytes,
    });

    const updateClaims = await Promise.all(
      Array.from({ length: 16 }, (_, index) => (index % 2 ? store : storePeer).claimUpdate(91001)),
    );
    assert.equal(updateClaims.filter(Boolean).length, 1);

    const linkToken = Buffer.alloc(24, 7).toString('base64url');
    const telegramUserId = '900000001';
    const customerRef = 'synthetic:counterparty:56';
    const binding = Object.freeze({
      schemaVersion: '1.0',
      telegramUserId,
      customerRef,
      channel: 'TELEGRAM_REQUEST_CONTACT',
      verifiedAt: new Date(now + 1_000).toISOString(),
    });
    assert.equal(await store.saveLink({
      linkSession: {
        version: '1.0',
        token: linkToken,
        createdAt: new Date(now).toISOString(),
        expiresAt: new Date(now + 10 * 60_000).toISOString(),
        consumedAt: null,
      },
      customerRef,
      expectedPhone: '+380671111111',
      sourceOrderIds: ['771'],
    }), true);
    assert.ok(await store.beginLink({ telegramUserId, token: linkToken }));
    assert.equal(await store.completeBinding({ telegramUserId, token: linkToken, binding }), true);
    assert.deepEqual(await store.getBinding(telegramUserId), binding);
    assert.equal(await store.completeBinding({ telegramUserId, token: linkToken, binding }), false);

    const choiceToken = await store.issueOrderChoice({
      telegramUserId,
      customerRef,
      sourceOrderId: '771',
      orderReference: 'SYNTHETIC-771',
    });
    assert.ok(choiceToken);
    const choiceResults = await Promise.all(
      Array.from({ length: 8 }, () => storePeer.consumeOrderChoice({ telegramUserId, token: choiceToken })),
    );
    const selections = choiceResults.filter(Boolean);
    assert.equal(selections.length, 1);
    assert.equal(selections[0].sourceOrderId, '771');

    const proofSessionId = await store.issueLookupGrant({
      telegramUserId,
      selection: selections[0],
    });
    assert.ok(proofSessionId);
    const grantResults = await Promise.all(
      Array.from({ length: 8 }, () => storePeer.consumeLookupGrant({ telegramUserId, proofSessionId })),
    );
    assert.equal(grantResults.filter(Boolean).length, 1);

    const limiter = createTelegramOrderRedisRateLimiter({
      sendCommand: redis.sendCommand,
      prefix: `${prefix}:rate`,
      limit: 3,
      windowMs: 60_000,
    });
    const rateResults = await Promise.all(
      Array.from({ length: 4 }, () => limiter.assess(telegramUserId)),
    );
    assert.equal(rateResults.filter((entry) => entry.allowed).length, 3);
    assert.equal(rateResults.filter((entry) => !entry.allowed).length, 1);

    const dispatched = [];
    const outbox = createTelegramOrderOutbox({
      sendCommand: redis.sendCommand,
      prefix: `${prefix}:outbox`,
      now: () => now,
      dispatch: async (action) => {
        dispatched.push(action);
        return true;
      },
    });
    const delivery = {
      deliveryId: 'synthetic-update:1:0:SEND_MESSAGE',
      action: {
        type: 'SEND_MESSAGE',
        chatId: telegramUserId,
        text: 'Synthetic compatibility message',
      },
    };
    assert.equal(await outbox.enqueue(delivery), true);
    assert.equal(await outbox.enqueue(delivery), true);
    assert.deepEqual(await outbox.drainOne(), {
      status: 'DELIVERED',
      deliveryId: delivery.deliveryId,
    });
    assert.deepEqual(await outbox.drainOne(), { status: 'EMPTY' });
    assert.equal(dispatched.length, 1);

    const markerKey = `${prefix}:persistence:marker`;
    assert.equal(await redis.sendCommand(['SET', markerKey, 'persisted-9.1.1']), 'OK');

    return {
      status: 'PASS',
      phase: 'compatibility',
      server: 'valkey',
      version: '9.1.1',
      nativeCommands: 'PASS',
      luaAtomicity: 'PASS',
      concurrency: 'PASS',
      outboxDeduplication: 'PASS',
      persistenceSeeded: true,
    };
  } finally {
    await redis.close();
  }
}

async function runRecovery() {
  const redis = await createTelegramOrderRedisClient({ url });
  await redis.connect();
  try {
    const serverInfo = String(await redis.sendCommand(['INFO', 'SERVER']));
    assert.match(serverInfo, /^valkey_version:9\.1\.1\r?$/mu);
    assert.equal(
      String(await redis.sendCommand(['GET', `${prefix}:persistence:marker`])),
      'persisted-9.1.1',
    );
    const persistenceInfo = String(await redis.sendCommand(['INFO', 'PERSISTENCE']));
    assert.match(persistenceInfo, /^aof_enabled:1\r?$/mu);
    assert.match(persistenceInfo, /^aof_last_write_status:ok\r?$/mu);
    assert.match(persistenceInfo, /^rdb_last_bgsave_status:ok\r?$/mu);
    return {
      status: 'PASS',
      phase: 'recovery',
      version: '9.1.1',
      markerRecovered: true,
      aof: 'PASS',
      rdb: 'PASS',
    };
  } finally {
    await redis.close();
  }
}

async function runOutage() {
  const client = createClient({
    url,
    socket: {
      connectTimeout: 300,
      reconnectStrategy: false,
    },
  });
  client.on('error', () => {});
  let connectionFailed = false;
  try {
    await client.connect();
  } catch {
    connectionFailed = true;
  } finally {
    if (client.isOpen) await client.close();
  }
  assert.equal(connectionFailed, true);

  const unavailable = async () => {
    throw new Error('VALKEY_TEST_UNAVAILABLE');
  };
  const limiter = createTelegramOrderRedisRateLimiter({
    sendCommand: unavailable,
    prefix: `${prefix}:outage-rate`,
  });
  assert.deepEqual(await limiter.assess('900000001'), {
    allowed: false,
    retryAfterMs: 60_000,
  });
  const outbox = createTelegramOrderOutbox({
    sendCommand: unavailable,
    prefix: `${prefix}:outage-outbox`,
    dispatch: async () => true,
  });
  assert.deepEqual(await outbox.drainOne(), { status: 'UNAVAILABLE' });

  return {
    status: 'PASS',
    phase: 'outage',
    connectionRefused: true,
    rateLimiter: 'DENY',
    outbox: 'UNAVAILABLE',
  };
}

function requireLoopbackUrl(value) {
  const parsed = new URL(String(value || ''));
  assert.equal(parsed.protocol, 'redis:');
  assert.ok(['127.0.0.1', 'localhost'].includes(parsed.hostname));
  assert.ok(parsed.port);
  assert.equal(parsed.username, '');
  assert.equal(parsed.password, '');
  return parsed.toString();
}

function normalizePrefix(value) {
  const normalized = String(value || '').trim();
  assert.match(normalized, /^[a-z0-9:_-]{3,40}$/u);
  return normalized;
}
