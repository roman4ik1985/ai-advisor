import { randomBytes, timingSafeEqual } from 'node:crypto';

const LINK_VERSION = '1.0';
const LINK_TTL_MS = 10 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 30 * 1000;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32}$/;
const CUSTOMER_REF_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;

const DENIED = Object.freeze({
  decision: 'DENY_BINDING',
  canBind: false,
  consumeLinkSession: false,
  binding: null,
});

export const TELEGRAM_ORDER_BINDING_CONTRACT = Object.freeze({
  version: LINK_VERSION,
  linkTtlMs: LINK_TTL_MS,
  channel: 'TELEGRAM_REQUEST_CONTACT',
  requires: Object.freeze([
    'one-time opaque deep-link token',
    'private bot chat',
    'contact shared by the current Telegram user',
    'phone match against the selected customer',
    'atomic link-session consumption',
  ]),
});

export function createTelegramLinkSession({
  now = Date.now(),
  randomBytesFn = randomBytes,
} = {}) {
  if (!Number.isFinite(now) || typeof randomBytesFn !== 'function') {
    throw new TypeError('A finite clock and random byte generator are required.');
  }
  const entropy = randomBytesFn(24);
  if (!Buffer.isBuffer(entropy) || entropy.length !== 24) {
    throw new TypeError('Telegram link entropy must be exactly 24 bytes.');
  }

  return Object.freeze({
    version: LINK_VERSION,
    token: entropy.toString('base64url'),
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + LINK_TTL_MS).toISOString(),
    consumedAt: null,
  });
}

export function verifyTelegramContactBinding({
  linkSession,
  startToken,
  update,
  expectedPhone,
  customerRef,
  now = Date.now(),
} = {}) {
  if (!Number.isFinite(now) || !validLinkSession(linkSession, now)) return DENIED;
  if (!safeTokenEquals(linkSession.token, startToken)) return DENIED;
  if (!CUSTOMER_REF_PATTERN.test(String(customerRef || ''))) return DENIED;

  const message = update?.message;
  const telegramUserId = safeTelegramId(message?.from?.id);
  const chatId = safeTelegramId(message?.chat?.id);
  const contactUserId = safeTelegramId(message?.contact?.user_id);
  if (
    message?.chat?.type !== 'private'
    || !telegramUserId
    || chatId !== telegramUserId
    || contactUserId !== telegramUserId
  ) {
    return DENIED;
  }

  const sharedPhone = normalizeUaPhone(message?.contact?.phone_number);
  const storedPhone = normalizeUaPhone(expectedPhone);
  if (!sharedPhone || !storedPhone || sharedPhone !== storedPhone) return DENIED;

  return Object.freeze({
    decision: 'ALLOW_BINDING',
    canBind: true,
    consumeLinkSession: true,
    binding: Object.freeze({
      schemaVersion: LINK_VERSION,
      telegramUserId,
      customerRef: String(customerRef),
      channel: 'TELEGRAM_REQUEST_CONTACT',
      verifiedAt: new Date(now).toISOString(),
    }),
  });
}

export function toPublicTelegramBindingResult(decision, locale = 'uk') {
  if (decision?.canBind === true && decision?.consumeLinkSession === true) {
    return Object.freeze({
      code: 'TELEGRAM_CUSTOMER_LINKED',
      message: locale === 'ru'
        ? 'Telegram успешно привязан. Используйте меню заказов.'
        : 'Telegram успішно прив’язано. Скористайтеся меню замовлень.',
    });
  }
  return Object.freeze({
    code: 'TELEGRAM_LINK_UNAVAILABLE',
    message: locale === 'ru'
      ? 'Не удалось подтвердить привязку. Повторите попытку из ассистента.'
      : 'Не вдалося підтвердити прив’язку. Повторіть спробу з асистента.',
  });
}

export function normalizeUaPhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (/^380\d{9}$/.test(digits)) return `+${digits}`;
  if (/^0\d{9}$/.test(digits)) return `+38${digits}`;
  if (/^80\d{9}$/.test(digits)) return `+3${digits}`;
  return null;
}

function validLinkSession(session, now) {
  if (!session || typeof session !== 'object' || Array.isArray(session)) return false;
  if (
    session.version !== LINK_VERSION
    || session.consumedAt != null
    || !TOKEN_PATTERN.test(String(session.token || ''))
  ) {
    return false;
  }
  const createdAt = Date.parse(session.createdAt);
  const expiresAt = Date.parse(session.expiresAt);
  return Number.isFinite(createdAt)
    && Number.isFinite(expiresAt)
    && createdAt <= now + MAX_FUTURE_SKEW_MS
    && expiresAt > now
    && expiresAt - createdAt > 0
    && expiresAt - createdAt <= LINK_TTL_MS;
}

function safeTokenEquals(expected, actual) {
  if (!TOKEN_PATTERN.test(String(expected || '')) || !TOKEN_PATTERN.test(String(actual || ''))) {
    return false;
  }
  return timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
}

function safeTelegramId(value) {
  const numeric = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  return Number.isSafeInteger(numeric) && numeric > 0 ? String(numeric) : null;
}
