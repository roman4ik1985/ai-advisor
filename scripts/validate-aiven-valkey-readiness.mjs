import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createClient } from 'redis';
import { createTelegramOrderOutbox } from '../telegram-order-outbox.mjs';

const mode = String(process.argv[2] || 'template');

if (mode === 'template') {
  await validateTemplate();
} else if (mode === 'live') {
  await validateLive();
} else {
  throw new Error('Usage: node scripts/validate-aiven-valkey-readiness.mjs <template|live>');
}

async function validateTemplate() {
  const files = await Promise.all([
    readFile(new URL('../infra/aiven/main.tf', import.meta.url), 'utf8'),
    readFile(new URL('../infra/aiven/variables.tf', import.meta.url), 'utf8'),
    readFile(new URL('../infra/aiven/outputs.tf', import.meta.url), 'utf8'),
  ]);
  const source = files.join('\n');
  const required = [
    'version = "~> 4.60"',
    'required_version = ">= 1.11.0"',
    'valkey_version          = "9.1"',
    'valkey_ssl              = true',
    'valkey_persistence      = "rdb"',
    'frequent_snapshots      = true',
    'valkey_maxmemory_policy = "noeviction"',
    'termination_protection = true',
    'password_wo',
    '"aiadvisor:*"',
    '"-flushall"',
    '"-flushdb"',
    '!contains(var.allowed_cidrs, "0.0.0.0/0")',
    'Connection credentials are intentionally not emitted.',
  ];
  for (const fragment of required) {
    assert.ok(source.includes(fragment), `Missing readiness contract: ${fragment}`);
  }

  const forbidden = [
    /token\s*=\s*"[^"]+"/iu,
    /password\s*=\s*"[^"]+"/iu,
    /rediss?:\/\/[^\s"]+/iu,
    /network\s*=\s*"0\.0\.0\.0\/0"/iu,
  ];
  for (const pattern of forbidden) {
    assert.doesNotMatch(source, pattern);
  }

  process.stdout.write(`${JSON.stringify({
    status: 'PASS',
    mode: 'template',
    provider: 'aiven',
    engine: 'valkey',
    version: '9.1',
    tls: true,
    persistence: 'rdb',
    activation: false,
    secretsEmbedded: false,
  })}\n`);
}

async function validateLive() {
  assert.notEqual(
    String(process.env.TELEGRAM_ORDER_ENABLED || '').trim().toLowerCase(),
    'true',
    'Live Valkey acceptance requires TELEGRAM_ORDER_ENABLED to remain false.',
  );
  const parsed = requireAivenUrl(process.env.VALKEY_AIVEN_TEST_URL);
  const prefix = `aiadvisor:accept:${randomBytes(8).toString('hex')}`;
  const keys = [
    `${prefix}:native`,
    `${prefix}:lua:a`,
    `${prefix}:lua:b`,
    `${prefix}:claim`,
  ];
  const client = createClient({
    url: parsed.toString(),
    socket: {
      connectTimeout: 5_000,
      reconnectStrategy: false,
    },
  });
  client.on('error', () => {});

  await client.connect();
  try {
    assert.equal(await client.ping(), 'PONG');
    const info = String(await client.sendCommand(['INFO', 'SERVER']));
    assert.match(info, /^server_name:valkey\r?$/mu);
    assert.match(info, /^valkey_version:9\.1(?:\.|\r?$)/mu);

    assert.equal(await client.sendCommand(['SET', keys[0], 'first', 'NX', 'PX', '60000']), 'OK');
    assert.equal(await client.sendCommand(['SET', keys[0], 'second', 'NX', 'PX', '60000']), null);
    assert.equal(await client.sendCommand(['GETDEL', keys[0]]), 'first');

    const luaResult = await client.sendCommand([
      'EVAL',
      "redis.call('SET', KEYS[1], ARGV[1], 'PX', 60000); redis.call('SET', KEYS[2], ARGV[2], 'PX', 60000); return 1",
      '2',
      keys[1],
      keys[2],
      'a',
      'b',
    ]);
    assert.equal(Number(luaResult), 1);

    const claims = await Promise.all(
      Array.from({ length: 16 }, () => client.sendCommand([
        'SET', keys[3], '1', 'NX', 'PX', '60000',
      ])),
    );
    assert.equal(claims.filter((value) => value === 'OK').length, 1);

    const deliveries = [];
    const outbox = createTelegramOrderOutbox({
      sendCommand: (args) => client.sendCommand([...args]),
      prefix: `${prefix}:outbox`,
      dispatch: async (action) => {
        deliveries.push(action);
        return true;
      },
    });
    const delivery = {
      deliveryId: 'synthetic:managed:1',
      action: {
        type: 'SEND_MESSAGE',
        chatId: '900000001',
        text: 'Synthetic managed Valkey acceptance',
      },
    };
    assert.equal(await outbox.enqueue(delivery), true);
    assert.equal(await outbox.enqueue(delivery), true);
    assert.equal((await outbox.drainOne()).status, 'DELIVERED');
    assert.equal(deliveries.length, 1);

    process.stdout.write(`${JSON.stringify({
      status: 'PASS',
      mode: 'live',
      provider: 'aiven',
      engine: 'valkey',
      version: '9.1.x',
      tls: true,
      nativeCommands: 'PASS',
      luaAtomicity: 'PASS',
      concurrency: 'PASS',
      outboxDeduplication: 'PASS',
      telegramEnabled: false,
    })}\n`);
  } finally {
    await client.sendCommand(['DEL', ...keys]).catch(() => {});
    await client.close().catch(() => {});
  }
}

function requireAivenUrl(value) {
  const parsed = new URL(String(value || ''));
  assert.equal(parsed.protocol, 'rediss:');
  assert.ok(parsed.hostname.endsWith('.aivencloud.com'));
  assert.ok(parsed.port);
  assert.ok(parsed.username);
  assert.ok(parsed.password);
  return parsed;
}
