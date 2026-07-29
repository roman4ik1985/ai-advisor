import test from 'node:test';
import assert from 'node:assert/strict';
import { createTelegramOrderRedisStore } from '../telegram-order-redis-store.mjs';

const NOW = Date.parse('2026-07-29T06:00:00.000Z');
const TOKEN = Buffer.alloc(24, 7).toString('base64url');

function fakeRedis() {
  const data = new Map();
  const commands = [];
  async function sendCommand(args) {
    commands.push(args);
    const [command, ...rest] = args;
    if (command === 'SET') {
      const [key, value] = rest;
      if (rest.includes('NX') && data.has(key)) return null;
      data.set(key, value);
      return 'OK';
    }
    if (command === 'GET') return data.get(rest[0]) ?? null;
    if (command === 'GETDEL') {
      const value = data.get(rest[0]) ?? null;
      data.delete(rest[0]);
      return value;
    }
    if (command === 'EVAL') {
      const pendingKey = rest[2];
      const linkKey = rest[3];
      const bindingKey = rest[4];
      const expectedToken = rest[5];
      if (data.get(pendingKey) !== expectedToken || !data.has(linkKey)) return 0;
      data.delete(pendingKey);
      data.delete(linkKey);
      data.set(bindingKey, rest[6]);
      return 1;
    }
    throw new Error(`Unsupported command ${command}`);
  }
  return { data, commands, sendCommand };
}

function linkSession() {
  return {
    version: '1.0',
    token: TOKEN,
    createdAt: '2026-07-29T06:00:00.000Z',
    expiresAt: '2026-07-29T06:10:00.000Z',
    consumedAt: null,
  };
}

function binding(userId = '100200300') {
  return {
    schemaVersion: '1.0',
    telegramUserId: userId,
    customerRef: 'salesdrive:counterparty:56',
    channel: 'TELEGRAM_REQUEST_CONTACT',
    verifiedAt: '2026-07-29T06:01:00.000Z',
  };
}

test('durable link is private, expiring, and atomically replaced by a phone-free binding', async () => {
  const redis = fakeRedis();
  const store = createTelegramOrderRedisStore({
    sendCommand: redis.sendCommand,
    now: () => NOW,
    randomBytesFn: () => Buffer.alloc(24, 7),
  });
  assert.equal(await store.saveLink({
    linkSession: linkSession(),
    customerRef: 'salesdrive:counterparty:56',
    expectedPhone: '+380671234567',
  }), true);
  const started = await store.beginLink({ telegramUserId: '100200300', token: TOKEN });
  assert.equal(started.customerRef, 'salesdrive:counterparty:56');
  assert.equal('expectedPhone' in started, false);
  const pending = await store.getPendingLink('100200300');
  assert.equal(pending.expectedPhone, '+380671234567');
  assert.equal(await store.completeBinding({
    telegramUserId: '100200300',
    token: TOKEN,
    binding: binding(),
  }), true);
  assert.deepEqual(await store.getBinding('100200300'), binding());
  assert.equal(await store.getPendingLink('100200300'), null);
  assert.equal(await store.completeBinding({
    telegramUserId: '100200300',
    token: TOKEN,
    binding: binding(),
  }), false);
});

test('update claims and choice tokens are single-use across repository instances', async () => {
  const redis = fakeRedis();
  const storeA = createTelegramOrderRedisStore({ sendCommand: redis.sendCommand, now: () => NOW, randomBytesFn: () => Buffer.alloc(24, 7) });
  const storeB = createTelegramOrderRedisStore({ sendCommand: redis.sendCommand, now: () => NOW, randomBytesFn: () => Buffer.alloc(24, 8) });
  assert.equal(await storeA.claimUpdate(123), true);
  assert.equal(await storeB.claimUpdate(123), false);

  redis.data.set('aiadvisor:telegram-order:binding:100200300', JSON.stringify(binding()));
  const token = await storeA.issueOrderChoice({
    telegramUserId: '100200300',
    customerRef: 'salesdrive:counterparty:56',
    sourceOrderId: '771',
    orderReference: 'OC-1042',
  });
  const selection = await storeB.consumeOrderChoice({ telegramUserId: '100200300', token });
  assert.equal(selection.sourceOrderId, '771');
  assert.equal(await storeA.consumeOrderChoice({ telegramUserId: '100200300', token }), null);
  assert.deepEqual(await storeA.getSelection('100200300'), selection);
});

test('choice tokens cannot cross Telegram bindings and are burned on mismatch', async () => {
  const redis = fakeRedis();
  redis.data.set('aiadvisor:telegram-order:binding:100200300', JSON.stringify(binding()));
  redis.data.set('aiadvisor:telegram-order:binding:999', JSON.stringify(binding('999')));
  const store = createTelegramOrderRedisStore({ sendCommand: redis.sendCommand, now: () => NOW, randomBytesFn: () => Buffer.alloc(24, 7) });
  const token = await store.issueOrderChoice({
    telegramUserId: '100200300',
    customerRef: 'salesdrive:counterparty:56',
    sourceOrderId: '771',
    orderReference: 'OC-1042',
  });
  assert.equal(await store.consumeOrderChoice({ telegramUserId: '999', token }), null);
  assert.equal(await store.consumeOrderChoice({ telegramUserId: '100200300', token }), null);
});

test('lookup grants keep order linkage server-side and are consumed exactly once', async () => {
  const redis = fakeRedis();
  const store = createTelegramOrderRedisStore({ sendCommand: redis.sendCommand, now: () => NOW, randomBytesFn: () => Buffer.alloc(24, 7) });
  const selection = {
    telegramUserId: '100200300',
    customerRef: 'salesdrive:counterparty:56',
    sourceOrderId: '771',
  };
  const proofSessionId = await store.issueLookupGrant({ telegramUserId: '100200300', selection });
  assert.equal(proofSessionId, TOKEN);
  const grant = await store.consumeLookupGrant({ telegramUserId: '100200300', proofSessionId });
  assert.equal(grant.sourceOrderId, '771');
  assert.equal(grant.proof.proofSessionId, TOKEN);
  assert.equal('sourceOrderId' in grant.proof, false);
  assert.equal(await store.consumeLookupGrant({ telegramUserId: '100200300', proofSessionId }), null);
});

test('invalid identifiers and malformed Redis records fail closed', async () => {
  const redis = fakeRedis();
  const store = createTelegramOrderRedisStore({ sendCommand: redis.sendCommand, now: () => NOW });
  assert.equal(await store.claimUpdate(-1), false);
  assert.equal(await store.beginLink({ telegramUserId: 'group', token: TOKEN }), null);
  assert.equal(await store.getBinding('invalid'), null);
  redis.data.set('aiadvisor:telegram-order:binding:100200300', '{broken');
  assert.equal(await store.getBinding('100200300'), null);
});
