import { randomBytes } from 'node:crypto';
import { createTelegramLinkSession } from './telegram-order-binding.mjs';

const ORDER_REFERENCE = /^[A-Za-z0-9._/-]{1,64}$/u;
const BOT_USERNAME = /^[A-Za-z][A-Za-z0-9_]{4,31}$/u;

export function createTelegramOrderProvisioner({
  candidateResolver,
  stateStore,
  botUsername,
  now = Date.now,
  randomBytesFn = randomBytes,
} = {}) {
  if (
    typeof candidateResolver?.resolveCandidate !== 'function'
    || typeof stateStore?.saveLink !== 'function'
    || !BOT_USERNAME.test(String(botUsername ?? ''))
  ) {
    throw new TypeError('Candidate resolver, state store, and Telegram bot username are required.');
  }

  async function provision({ orderReference } = {}) {
    const reference = String(orderReference ?? '').trim();
    const linkSession = createTelegramLinkSession({ now: now(), randomBytesFn });
    const candidate = ORDER_REFERENCE.test(reference)
      ? await candidateResolver.resolveCandidate(reference)
      : null;
    const decoyRef = randomBytesFn(12).toString('hex');
    const stored = await stateStore.saveLink({
      linkSession,
      customerRef: candidate?.customerRef ?? `decoy:${decoyRef}`,
      expectedPhone: candidate?.expectedPhone ?? 'invalid',
      sourceOrderIds: candidate?.sourceOrderIds ?? [],
    });
    if (!stored) throw new Error('TELEGRAM_ORDER_LINK_UNAVAILABLE');
    return publicResult(botUsername, linkSession.token);
  }

  return Object.freeze({ provision });
}

function publicResult(botUsername, token) {
  return Object.freeze({
    code: 'TELEGRAM_ORDER_LINK_READY',
    button: Object.freeze({
      text: 'Перевірити замовлення в Telegram',
      url: `https://t.me/${botUsername}?start=${token}`,
    }),
    expiresInSeconds: 600,
  });
}
