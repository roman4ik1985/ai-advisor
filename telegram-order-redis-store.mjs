import { randomBytes } from 'node:crypto';

const DEFAULT_PREFIX = 'aiadvisor:telegram-order';
const BINDING_TTL_MS = 180 * 24 * 60 * 60 * 1000;
const CHOICE_TTL_MS = 10 * 60 * 1000;
const SELECTION_TTL_MS = 30 * 60 * 1000;
const PROOF_TTL_MS = 10 * 60 * 1000;
const UPDATE_TTL_MS = 24 * 60 * 60 * 1000;
const TOKEN = /^[A-Za-z0-9_-]{32}$/u;
const PROOF_ID = /^[A-Za-z0-9_-]{24,128}$/u;
const TELEGRAM_ID = /^[1-9]\d{0,19}$/u;
const SOURCE_ORDER_ID = /^[1-9]\d{0,18}$/u;

const COMPLETE_BINDING_SCRIPT = `
local pending = redis.call('GET', KEYS[1])
local link = redis.call('GET', KEYS[2])
if not pending or pending ~= ARGV[1] or not link then return 0 end
redis.call('DEL', KEYS[1])
redis.call('DEL', KEYS[2])
redis.call('SET', KEYS[3], ARGV[2], 'PX', ARGV[3])
return 1
`.trim();

export const TELEGRAM_ORDER_REDIS_STATE_CONTRACT = Object.freeze({
  atomicOperations: Object.freeze(['claim update', 'create token', 'consume token', 'complete binding']),
  storesPhoneOnlyInExpiringLink: true,
  bindingTtlMs: BINDING_TTL_MS,
  choiceTtlMs: CHOICE_TTL_MS,
  selectionTtlMs: SELECTION_TTL_MS,
  proofTtlMs: PROOF_TTL_MS,
});

export function createTelegramOrderRedisStore({
  sendCommand,
  prefix = DEFAULT_PREFIX,
  now = Date.now,
  randomBytesFn = randomBytes,
} = {}) {
  if (typeof sendCommand !== 'function' || typeof now !== 'function' || typeof randomBytesFn !== 'function') {
    throw new TypeError('Redis command, clock, and entropy adapters are required.');
  }
  const safePrefix = normalizePrefix(prefix);

  async function claimUpdate(updateId) {
    if (!Number.isSafeInteger(updateId) || updateId < 0) return false;
    const result = await command([
      'SET', key('update', String(updateId)), '1', 'NX', 'PX', String(UPDATE_TTL_MS),
    ]);
    return result === 'OK';
  }

  async function saveLink({ linkSession, customerRef, expectedPhone, sourceOrderIds = [] } = {}) {
    const token = String(linkSession?.token ?? '');
    const expiresAt = Date.parse(linkSession?.expiresAt);
    const ttlMs = expiresAt - now();
    if (!TOKEN.test(token) || !validCustomerRef(customerRef) || !String(expectedPhone ?? '').trim()) return false;
    if (!Number.isFinite(ttlMs) || ttlMs <= 0 || ttlMs > PROOF_TTL_MS) return false;
    const record = JSON.stringify({
      linkSession,
      customerRef: String(customerRef),
      expectedPhone: String(expectedPhone),
      sourceOrderIds: normalizeSourceOrderIds(sourceOrderIds),
    });
    return await command(['SET', key('link', token), record, 'NX', 'PX', String(ttlMs)]) === 'OK';
  }

  async function beginLink({ telegramUserId, token } = {}) {
    const userId = normalizeTelegramId(telegramUserId);
    if (!userId || !TOKEN.test(String(token ?? ''))) return null;
    const record = parseRecord(await command(['GET', key('link', token)]));
    if (!record || Date.parse(record.linkSession?.expiresAt) <= now()) return null;
    const ttlMs = Math.max(1, Date.parse(record.linkSession.expiresAt) - now());
    const stored = await command([
      'SET', key('pending', userId), String(token), 'PX', String(ttlMs),
    ]);
    return stored === 'OK' ? redactLinkRecord(record) : null;
  }

  async function getPendingLink(telegramUserId) {
    const userId = normalizeTelegramId(telegramUserId);
    if (!userId) return null;
    const token = stringValue(await command(['GET', key('pending', userId)]));
    if (!TOKEN.test(token)) return null;
    const record = parseRecord(await command(['GET', key('link', token)]));
    return record ? { token, ...record } : null;
  }

  async function completeBinding({ telegramUserId, token, binding } = {}) {
    const userId = normalizeTelegramId(telegramUserId);
    if (!userId || !TOKEN.test(String(token ?? '')) || !validBinding(binding, userId)) return false;
    const linkRecord = parseRecord(await command(['GET', key('link', token)]));
    const result = await command([
      'EVAL',
      COMPLETE_BINDING_SCRIPT,
      '3',
      key('pending', userId),
      key('link', token),
      key('binding', userId),
      String(token),
      JSON.stringify(binding),
      String(BINDING_TTL_MS),
    ]);
    if (Number(result) !== 1) return false;
    const sourceOrderIds = normalizeSourceOrderIds(linkRecord?.sourceOrderIds);
    const stored = await command([
      'SET', key('owned', userId), JSON.stringify(sourceOrderIds), 'PX', String(BINDING_TTL_MS),
    ]);
    return stored === 'OK';
  }

  async function getBinding(telegramUserId) {
    const userId = normalizeTelegramId(telegramUserId);
    if (!userId) return null;
    const binding = parseRecord(await command(['GET', key('binding', userId)]));
    return validBinding(binding, userId) ? Object.freeze(binding) : null;
  }

  async function getOwnedSourceOrderIds(telegramUserId) {
    const userId = normalizeTelegramId(telegramUserId);
    if (!userId || !await getBinding(userId)) return [];
    const value = await command(['GET', key('owned', userId)]);
    try {
      return normalizeSourceOrderIds(JSON.parse(stringValue(value)));
    } catch {
      return [];
    }
  }

  async function issueOrderChoice({ telegramUserId, customerRef, sourceOrderId, orderReference } = {}) {
    const userId = normalizeTelegramId(telegramUserId);
    if (!userId || !validCustomerRef(customerRef) || !SOURCE_ORDER_ID.test(String(sourceOrderId ?? ''))) return null;
    const token = opaqueToken();
    const record = JSON.stringify({
      telegramUserId: userId,
      customerRef: String(customerRef),
      sourceOrderId: String(sourceOrderId),
      orderReference: boundedText(orderReference, 64),
    });
    const stored = await command([
      'SET', key('choice', token), record, 'NX', 'PX', String(CHOICE_TTL_MS),
    ]);
    return stored === 'OK' ? token : null;
  }

  async function consumeOrderChoice({ telegramUserId, token } = {}) {
    const userId = normalizeTelegramId(telegramUserId);
    if (!userId || !TOKEN.test(String(token ?? ''))) return null;
    const choice = parseRecord(await command(['GETDEL', key('choice', token)]));
    const binding = await getBinding(userId);
    if (
      !choice
      || !binding
      || choice.telegramUserId !== userId
      || choice.customerRef !== binding.customerRef
      || !SOURCE_ORDER_ID.test(String(choice.sourceOrderId ?? ''))
    ) {
      return null;
    }
    const selection = {
      telegramUserId: userId,
      customerRef: binding.customerRef,
      sourceOrderId: choice.sourceOrderId,
      orderReference: boundedText(choice.orderReference, 64),
      selectedAt: new Date(now()).toISOString(),
    };
    const stored = await command([
      'SET', key('selection', userId), JSON.stringify(selection), 'PX', String(SELECTION_TTL_MS),
    ]);
    return stored === 'OK' ? Object.freeze(selection) : null;
  }

  async function getSelection(telegramUserId) {
    const userId = normalizeTelegramId(telegramUserId);
    if (!userId) return null;
    const selection = parseRecord(await command(['GET', key('selection', userId)]));
    return selection?.telegramUserId === userId
      && validCustomerRef(selection.customerRef)
      && SOURCE_ORDER_ID.test(String(selection.sourceOrderId ?? ''))
      ? Object.freeze(selection)
      : null;
  }

  async function issueLookupGrant({ telegramUserId, selection } = {}) {
    const userId = normalizeTelegramId(telegramUserId);
    if (
      !userId
      || selection?.telegramUserId !== userId
      || !validCustomerRef(selection?.customerRef)
      || !SOURCE_ORDER_ID.test(String(selection?.sourceOrderId ?? ''))
    ) {
      return null;
    }
    const proofSessionId = opaqueToken();
    const timestamp = now();
    const proof = {
      version: '1.2',
      state: 'VERIFIED',
      purpose: 'ORDER_STATUS',
      proofSessionId,
      verifiedAt: new Date(timestamp).toISOString(),
      expiresAt: new Date(timestamp + PROOF_TTL_MS).toISOString(),
      consumedAt: null,
      telegramBindingVerified: true,
      orderOwnershipVerified: true,
    };
    const record = JSON.stringify({
      telegramUserId: userId,
      customerRef: selection.customerRef,
      sourceOrderId: selection.sourceOrderId,
      proof,
    });
    const stored = await command([
      'SET', key('proof', proofSessionId), record, 'NX', 'PX', String(PROOF_TTL_MS),
    ]);
    return stored === 'OK' ? proofSessionId : null;
  }

  async function consumeLookupGrant({ telegramUserId, proofSessionId } = {}) {
    const userId = normalizeTelegramId(telegramUserId);
    if (!userId || !PROOF_ID.test(String(proofSessionId ?? ''))) return null;
    const grant = parseRecord(await command(['GETDEL', key('proof', proofSessionId)]));
    return grant?.telegramUserId === userId
      && validCustomerRef(grant.customerRef)
      && SOURCE_ORDER_ID.test(String(grant.sourceOrderId ?? ''))
      ? Object.freeze(grant)
      : null;
  }

  function opaqueToken() {
    const entropy = randomBytesFn(24);
    if (!Buffer.isBuffer(entropy) || entropy.length !== 24) {
      throw new TypeError('Token entropy must be exactly 24 bytes.');
    }
    return entropy.toString('base64url');
  }

  async function command(args) {
    return sendCommand(Object.freeze([...args]));
  }

  function key(kind, id) {
    return `${safePrefix}:${kind}:${id}`;
  }

  return Object.freeze({
    claimUpdate,
    saveLink,
    beginLink,
    getPendingLink,
    completeBinding,
    getBinding,
    getOwnedSourceOrderIds,
    issueOrderChoice,
    consumeOrderChoice,
    getSelection,
    issueLookupGrant,
    consumeLookupGrant,
  });
}

function redactLinkRecord(record) {
  return Object.freeze({
    linkSession: record.linkSession,
    customerRef: record.customerRef,
  });
}

function validBinding(binding, expectedUserId) {
  return binding
    && binding.telegramUserId === expectedUserId
    && binding.channel === 'TELEGRAM_REQUEST_CONTACT'
    && validCustomerRef(binding.customerRef)
    && Number.isFinite(Date.parse(binding.verifiedAt));
}

function validCustomerRef(value) {
  return /^[A-Za-z0-9:_-]{1,128}$/u.test(String(value ?? ''));
}

function normalizeSourceOrderIds(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(String).filter((item) => SOURCE_ORDER_ID.test(item)))].slice(0, 20);
}

function normalizeTelegramId(value) {
  const normalized = String(value ?? '');
  return TELEGRAM_ID.test(normalized) ? normalized : null;
}

function normalizePrefix(value) {
  const normalized = String(value ?? '').trim();
  if (!/^[a-z0-9:_-]{3,64}$/iu.test(normalized)) throw new TypeError('Invalid Redis key prefix.');
  return normalized;
}

function boundedText(value, maxLength) {
  const normalized = String(value ?? '').trim();
  return normalized && normalized.length <= maxLength ? normalized : null;
}

function parseRecord(value) {
  try {
    const parsed = JSON.parse(stringValue(value));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function stringValue(value) {
  return Buffer.isBuffer(value) ? value.toString('utf8') : String(value ?? '');
}
