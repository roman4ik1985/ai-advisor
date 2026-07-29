const DELIVERY_ID = /^[A-Za-z0-9:_-]{8,160}$/u;
const OUTBOX_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_VISIBILITY_TIMEOUT_MS = 30_000;

const ENQUEUE_SCRIPT = `
if redis.call('EXISTS', KEYS[1]) == 1 then return 1 end
redis.call('HSET', KEYS[1], 'payload', ARGV[1], 'attempts', '0')
redis.call('PEXPIRE', KEYS[1], ARGV[2])
redis.call('ZADD', KEYS[2], ARGV[3], ARGV[4])
return 1
`.trim();

const CLAIM_SCRIPT = `
local ids = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', ARGV[1], 'LIMIT', 0, 1)
if #ids == 0 then return nil end
local id = ids[1]
local record = KEYS[2] .. id
local payload = redis.call('HGET', record, 'payload')
if not payload then
  redis.call('ZREM', KEYS[1], id)
  return nil
end
local attempts = redis.call('HINCRBY', record, 'attempts', 1)
redis.call('ZADD', KEYS[1], ARGV[2], id)
return { id, payload, tostring(attempts) }
`.trim();

const ACK_SCRIPT = `
redis.call('ZREM', KEYS[1], ARGV[1])
redis.call('DEL', KEYS[2])
return 1
`.trim();

const DEAD_LETTER_SCRIPT = `
local payload = redis.call('HGET', KEYS[2], 'payload')
redis.call('ZREM', KEYS[1], ARGV[1])
redis.call('DEL', KEYS[2])
if payload then
  redis.call('SET', KEYS[3], payload, 'PX', ARGV[2])
end
return 1
`.trim();

export const TELEGRAM_ORDER_OUTBOX_CONTRACT = Object.freeze({
  delivery: 'at-least-once',
  enqueueDeduplication: true,
  visibilityTimeoutMs: DEFAULT_VISIBILITY_TIMEOUT_MS,
  retentionMs: OUTBOX_TTL_MS,
});

export function createTelegramOrderOutbox({
  sendCommand,
  dispatch,
  prefix = 'aiadvisor:telegram-order:outbox',
  now = Date.now,
  visibilityTimeoutMs = DEFAULT_VISIBILITY_TIMEOUT_MS,
  maxAttempts = 8,
} = {}) {
  if (
    typeof sendCommand !== 'function'
    || typeof dispatch !== 'function'
    || typeof now !== 'function'
    || !/^[a-z0-9:_-]{3,80}$/iu.test(String(prefix))
    || !Number.isSafeInteger(visibilityTimeoutMs)
    || visibilityTimeoutMs < 1_000
    || visibilityTimeoutMs > 300_000
    || !Number.isSafeInteger(maxAttempts)
    || maxAttempts < 1
    || maxAttempts > 20
  ) {
    throw new TypeError('Valid Redis, dispatch, timing, and retry adapters are required.');
  }

  const queueKey = `${prefix}:due`;
  const recordPrefix = `${prefix}:record:`;
  const deadPrefix = `${prefix}:dead:`;

  async function enqueue({ deliveryId, action } = {}) {
    const id = String(deliveryId ?? '');
    const safeAction = normalizeAction(action);
    if (!DELIVERY_ID.test(id) || !safeAction) return false;
    try {
      return Number(await sendCommand(Object.freeze([
        'EVAL',
        ENQUEUE_SCRIPT,
        '2',
        `${recordPrefix}${id}`,
        queueKey,
        JSON.stringify(safeAction),
        String(OUTBOX_TTL_MS),
        String(now()),
        id,
      ]))) === 1;
    } catch {
      return false;
    }
  }

  async function drainOne() {
    let claimed;
    try {
      claimed = await sendCommand(Object.freeze([
        'EVAL',
        CLAIM_SCRIPT,
        '2',
        queueKey,
        recordPrefix,
        String(now()),
        String(now() + visibilityTimeoutMs),
      ]));
    } catch {
      return Object.freeze({ status: 'UNAVAILABLE' });
    }
    const record = parseClaim(claimed);
    if (!record) return Object.freeze({ status: 'EMPTY' });

    let delivered = false;
    try {
      delivered = await dispatch(record.action) === true;
    } catch {
      delivered = false;
    }
    if (delivered) {
      await acknowledge(record.deliveryId);
      return Object.freeze({ status: 'DELIVERED', deliveryId: record.deliveryId });
    }
    if (record.attempts >= maxAttempts) {
      await deadLetter(record.deliveryId);
      return Object.freeze({ status: 'DEAD_LETTERED', deliveryId: record.deliveryId });
    }
    return Object.freeze({ status: 'RETRY_SCHEDULED', deliveryId: record.deliveryId });
  }

  async function drain({ limit = 20 } = {}) {
    const boundedLimit = Number.isSafeInteger(limit) ? Math.min(100, Math.max(1, limit)) : 20;
    const results = [];
    for (let index = 0; index < boundedLimit; index += 1) {
      const result = await drainOne();
      results.push(result);
      if (result.status === 'EMPTY' || result.status === 'UNAVAILABLE') break;
    }
    return Object.freeze(results);
  }

  async function acknowledge(deliveryId) {
    try {
      return Number(await sendCommand(Object.freeze([
        'EVAL',
        ACK_SCRIPT,
        '2',
        queueKey,
        `${recordPrefix}${deliveryId}`,
        deliveryId,
      ]))) === 1;
    } catch {
      return false;
    }
  }

  async function deadLetter(deliveryId) {
    try {
      return Number(await sendCommand(Object.freeze([
        'EVAL',
        DEAD_LETTER_SCRIPT,
        '3',
        queueKey,
        `${recordPrefix}${deliveryId}`,
        `${deadPrefix}${deliveryId}`,
        deliveryId,
        String(OUTBOX_TTL_MS),
      ]))) === 1;
    } catch {
      return false;
    }
  }

  return Object.freeze({ enqueue, drainOne, drain });
}

function normalizeAction(action) {
  if (!action || typeof action !== 'object' || Array.isArray(action)) return null;
  if (action.type === 'SEND_MESSAGE') {
    const chatId = telegramId(action.chatId);
    const text = boundedText(action.text, 4_000);
    if (!chatId || !text) return null;
    return Object.freeze({
      type: 'SEND_MESSAGE',
      chatId,
      text,
      ...(action.replyMarkup ? { replyMarkup: action.replyMarkup } : {}),
    });
  }
  if (action.type === 'ANSWER_CALLBACK') {
    const callbackQueryId = boundedText(action.callbackQueryId, 128);
    return callbackQueryId ? Object.freeze({ type: 'ANSWER_CALLBACK', callbackQueryId }) : null;
  }
  if (action.type === 'REQUEST_MANAGER' || action.type === 'OPEN_NOTIFICATION_SETTINGS') {
    const telegramUserId = telegramId(action.telegramUserId);
    const customerRef = customerReference(action.customerRef);
    return telegramUserId && customerRef
      ? Object.freeze({ type: action.type, telegramUserId, customerRef })
      : null;
  }
  return null;
}

function parseClaim(value) {
  if (!Array.isArray(value) || value.length !== 3 || !DELIVERY_ID.test(String(value[0] ?? ''))) return null;
  try {
    const action = normalizeAction(JSON.parse(String(value[1] ?? '')));
    const attempts = Number(value[2]);
    return action && Number.isSafeInteger(attempts) && attempts > 0
      ? Object.freeze({ deliveryId: String(value[0]), action, attempts })
      : null;
  } catch {
    return null;
  }
}

function telegramId(value) {
  const normalized = String(value ?? '');
  return /^[1-9]\d{0,19}$/u.test(normalized) ? normalized : null;
}

function customerReference(value) {
  const normalized = String(value ?? '');
  return /^[A-Za-z0-9:_-]{1,128}$/u.test(normalized) ? normalized : null;
}

function boundedText(value, maxLength) {
  const normalized = String(value ?? '').trim();
  return normalized && normalized.length <= maxLength ? normalized : null;
}
