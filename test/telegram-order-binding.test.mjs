import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TELEGRAM_ORDER_BINDING_CONTRACT,
  createTelegramLinkSession,
  normalizeUaPhone,
  toPublicTelegramBindingResult,
  verifyTelegramContactBinding,
} from '../telegram-order-binding.mjs';

const NOW = Date.parse('2026-07-29T05:00:00.000Z');
const TOKEN_BYTES = Buffer.from(Array.from({ length: 24 }, (_, index) => index + 1));

function linkSession() {
  return createTelegramLinkSession({ now: NOW, randomBytesFn: () => TOKEN_BYTES });
}

function contactUpdate(overrides = {}) {
  return {
    message: {
      chat: { id: 123456789, type: 'private' },
      from: { id: 123456789 },
      contact: { user_id: 123456789, phone_number: '+380 67 123 45 67' },
      ...overrides,
    },
  };
}

function verify(overrides = {}) {
  const session = linkSession();
  return verifyTelegramContactBinding({
    linkSession: session,
    startToken: session.token,
    update: contactUpdate(),
    expectedPhone: '0671234567',
    customerRef: 'customer:42',
    now: NOW + 60_000,
    ...overrides,
  });
}

test('C21 contract uses one-time private request_contact binding', () => {
  assert.equal(TELEGRAM_ORDER_BINDING_CONTRACT.channel, 'TELEGRAM_REQUEST_CONTACT');
  assert.ok(TELEGRAM_ORDER_BINDING_CONTRACT.requires.includes('private bot chat'));
  assert.ok(TELEGRAM_ORDER_BINDING_CONTRACT.requires.includes('atomic link-session consumption'));
});

test('link session uses bounded opaque entropy and expires after ten minutes', () => {
  const session = linkSession();
  assert.match(session.token, /^[A-Za-z0-9_-]{32}$/);
  assert.equal(session.createdAt, '2026-07-29T05:00:00.000Z');
  assert.equal(session.expiresAt, '2026-07-29T05:10:00.000Z');
  assert.equal(session.consumedAt, null);
});

test('valid private own-contact proof returns a phone-free customer binding', () => {
  const result = verify();
  assert.equal(result.canBind, true);
  assert.equal(result.consumeLinkSession, true);
  assert.deepEqual(result.binding, {
    schemaVersion: '1.0',
    telegramUserId: '123456789',
    customerRef: 'customer:42',
    channel: 'TELEGRAM_REQUEST_CONTACT',
    verifiedAt: '2026-07-29T05:01:00.000Z',
  });
  assert.doesNotMatch(JSON.stringify(result.binding), /380|067123|phone/i);
});

test('typed phone, forwarded contact, group chat, and mismatched chat identity are rejected', () => {
  const invalidUpdates = [
    { message: { chat: { id: 123456789, type: 'private' }, from: { id: 123456789 }, text: '0671234567' } },
    contactUpdate({ contact: { user_id: 777, phone_number: '+380671234567' } }),
    contactUpdate({ chat: { id: -100123, type: 'group' } }),
    contactUpdate({ chat: { id: 777, type: 'private' } }),
  ];
  for (const update of invalidUpdates) {
    assert.equal(verify({ update }).canBind, false);
  }
});

test('phone must match the selected customer after normalization', () => {
  assert.equal(verify({ expectedPhone: '+380501112233' }).canBind, false);
  assert.equal(verify({ expectedPhone: 'not-a-phone' }).canBind, false);
  assert.equal(verify({
    update: contactUpdate({ contact: { user_id: 123456789, phone_number: '+380501112233' } }),
  }).canBind, false);
});

test('expired, consumed, malformed, and overlong link sessions are rejected', () => {
  const session = linkSession();
  const invalidSessions = [
    { ...session, consumedAt: '2026-07-29T05:00:30.000Z' },
    { ...session, token: 'short' },
    { ...session, expiresAt: '2026-07-29T05:00:00.000Z' },
    { ...session, expiresAt: '2026-07-29T05:10:01.000Z' },
  ];
  for (const candidate of invalidSessions) {
    assert.equal(verify({ linkSession: candidate }).canBind, false);
  }
  assert.equal(verify({ now: NOW + 10 * 60 * 1000 }).canBind, false);
});

test('wrong or malformed deep-link token is rejected', () => {
  assert.equal(verify({ startToken: 'x'.repeat(32) }).canBind, false);
  assert.equal(verify({ startToken: 'invalid token' }).canBind, false);
});

test('customer reference must be opaque and bounded', () => {
  for (const customerRef of ['', 'customer email@example.com', 'x'.repeat(129)]) {
    assert.equal(verify({ customerRef }).canBind, false);
  }
});

test('phone normalization supports common Ukrainian representations only', () => {
  assert.equal(normalizeUaPhone('+380 (67) 123-45-67'), '+380671234567');
  assert.equal(normalizeUaPhone('0671234567'), '+380671234567');
  assert.equal(normalizeUaPhone('80671234567'), '+380671234567');
  assert.equal(normalizeUaPhone('+48123456789'), null);
});

test('public failure is neutral and contains no identity details', () => {
  const failed = toPublicTelegramBindingResult(verify({ expectedPhone: '+380501112233' }), 'uk');
  assert.deepEqual(failed, {
    code: 'TELEGRAM_LINK_UNAVAILABLE',
    message: 'Не вдалося підтвердити прив’язку. Повторіть спробу з асистента.',
  });
  assert.doesNotMatch(JSON.stringify(failed), /phone|customer|123456789|380/i);
});

test('link entropy generator must return exactly 24 bytes', () => {
  assert.throws(
    () => createTelegramLinkSession({ now: NOW, randomBytesFn: () => Buffer.alloc(8) }),
    /24 bytes/,
  );
});
