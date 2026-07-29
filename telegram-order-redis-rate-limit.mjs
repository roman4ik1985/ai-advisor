const SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 1 then ttl = tonumber(ARGV[1]) end
return {count, ttl}
`.trim();

export const TELEGRAM_ORDER_DISTRIBUTED_LIMIT_CONTRACT = Object.freeze({
  algorithm: 'Redis atomic fixed window',
  defaultLimit: 10,
  defaultWindowMs: 60_000,
  failureMode: 'deny',
});

export function createTelegramOrderRedisRateLimiter({
  sendCommand,
  prefix = 'aiadvisor:telegram-order:rate',
  limit = 10,
  windowMs = 60_000,
} = {}) {
  if (
    typeof sendCommand !== 'function'
    || !/^[a-z0-9:_-]{3,64}$/iu.test(String(prefix))
    || !Number.isSafeInteger(limit)
    || limit < 1
    || !Number.isSafeInteger(windowMs)
    || windowMs < 1_000
  ) {
    throw new TypeError('Valid Redis command, key prefix, limit, and window are required.');
  }

  async function assess(telegramUserId) {
    const userId = String(telegramUserId ?? '');
    if (!/^[1-9]\d{0,19}$/u.test(userId)) return denied(windowMs);
    try {
      const result = await sendCommand(Object.freeze([
        'EVAL',
        SCRIPT,
        '1',
        `${prefix}:${userId}`,
        String(windowMs),
      ]));
      const count = Number(result?.[0]);
      const retryAfterMs = Math.max(1, Number(result?.[1]) || windowMs);
      return count > 0 && count <= limit
        ? Object.freeze({ allowed: true, retryAfterMs: 0 })
        : denied(retryAfterMs);
    } catch {
      return denied(windowMs);
    }
  }

  return Object.freeze({ assess });
}

function denied(retryAfterMs) {
  return Object.freeze({ allowed: false, retryAfterMs });
}
