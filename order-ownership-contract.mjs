const CONTRACT_VERSION = '1.0';
const PURPOSE = 'ORDER_STATUS';
const MAX_PROOF_TTL_MS = 10 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 30 * 1000;
const PROOF_SESSION_ID = /^[A-Za-z0-9_-]{24,128}$/;

const ALLOWED_ENVELOPE_KEYS = new Set([
  'version',
  'state',
  'purpose',
  'proofSessionId',
  'verifiedAt',
  'expiresAt',
  'consumedAt',
  'subjectBindingVerified',
  'channelBindingVerified',
  'nonceBindingVerified',
  'attemptPolicyVerified',
]);

export const ORDER_OWNERSHIP_CONTRACT = Object.freeze({
  version: CONTRACT_VERSION,
  purpose: PURPOSE,
  proofStates: Object.freeze([
    'UNVERIFIED',
    'CHALLENGE_PENDING',
    'VERIFIED',
    'DENIED',
    'EXPIRED',
    'LOCKED',
  ]),
  maxProofTtlMs: MAX_PROOF_TTL_MS,
  maxFutureClockSkewMs: MAX_FUTURE_SKEW_MS,
  requires: Object.freeze([
    'opaque proof session',
    'server-side subject binding',
    'trusted-channel binding',
    'single-use nonce binding',
    'bounded attempt policy',
    'atomic consumption before order lookup',
  ]),
  forbids: Object.freeze([
    'anonymous order lookup',
    'order existence disclosure before proof',
    'raw order or customer data in the proof envelope',
    'proof secrets in browser, model context, or ordinary logs',
  ]),
});

const DENIED = Object.freeze({
  contractVersion: CONTRACT_VERSION,
  decision: 'DENY_LOOKUP',
  publicCode: 'OWNERSHIP_VERIFICATION_REQUIRED',
  canLookupOrder: false,
  requiresAtomicConsumption: false,
});

const ALLOWED = Object.freeze({
  contractVersion: CONTRACT_VERSION,
  decision: 'ALLOW_LOOKUP',
  publicCode: 'OWNERSHIP_VERIFIED',
  canLookupOrder: true,
  requiresAtomicConsumption: true,
});

/**
 * Evaluates only an opaque, server-produced proof envelope. It deliberately
 * accepts no order locator, customer field, order-existence flag, or status
 * payload. Every malformed, incomplete, expired, or replayed proof fails closed.
 */
export function assessOrderOwnershipProof(envelope, { now = Date.now() } = {}) {
  if (!isPlainObject(envelope) || !Number.isFinite(now)) return DENIED;
  if (Object.keys(envelope).some((key) => !ALLOWED_ENVELOPE_KEYS.has(key))) return DENIED;
  if (
    envelope.version !== CONTRACT_VERSION
    || envelope.purpose !== PURPOSE
    || envelope.state !== 'VERIFIED'
    || !PROOF_SESSION_ID.test(String(envelope.proofSessionId || ''))
    || envelope.consumedAt != null
    || envelope.subjectBindingVerified !== true
    || envelope.channelBindingVerified !== true
    || envelope.nonceBindingVerified !== true
    || envelope.attemptPolicyVerified !== true
  ) {
    return DENIED;
  }

  const verifiedAt = Date.parse(envelope.verifiedAt);
  const expiresAt = Date.parse(envelope.expiresAt);
  const ttl = expiresAt - verifiedAt;
  if (
    !Number.isFinite(verifiedAt)
    || !Number.isFinite(expiresAt)
    || verifiedAt > now + MAX_FUTURE_SKEW_MS
    || expiresAt <= now
    || ttl <= 0
    || ttl > MAX_PROOF_TTL_MS
  ) {
    return DENIED;
  }

  return ALLOWED;
}

export function toPublicOwnershipResult(assessment, locale = 'ru') {
  if (assessment === ALLOWED) {
    return Object.freeze({
      code: 'OWNERSHIP_VERIFIED',
      message: locale === 'uk'
        ? 'Право на перегляд замовлення підтверджено.'
        : 'Право на просмотр заказа подтверждено.',
    });
  }

  return Object.freeze({
    code: 'OWNERSHIP_VERIFICATION_REQUIRED',
    message: locale === 'uk'
      ? 'Для перегляду статусу потрібне безпечне підтвердження власника замовлення.'
      : 'Для просмотра статуса требуется безопасное подтверждение владельца заказа.',
  });
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
