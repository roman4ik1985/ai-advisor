import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TELEGRAM_ORDER_DISTRIBUTED_LIMIT_CONTRACT,
  createTelegramOrderRedisRateLimiter,
} from '../telegram-order-redis-rate-limit.mjs';

test('distributed limiter delegates one atomic Redis script per action', async () => {
  const commands = [];
  const limiter = createTelegramOrderRedisRateLimiter({
    sendCommand: async (args) => {
      commands.push(args);
      return [1, 59_000];
    },
    limit: 2,
    windowMs: 60_000,
  });
  assert.deepEqual(await limiter.assess('100200300'), { allowed: true, retryAfterMs: 0 });
  assert.equal(commands[0][0], 'EVAL');
  assert.equal(commands[0][3], 'aiadvisor:telegram-order:rate:100200300');
  assert.equal(TELEGRAM_ORDER_DISTRIBUTED_LIMIT_CONTRACT.failureMode, 'deny');
});

test('limit exceeded and Redis failure both fail closed', async () => {
  const exceeded = createTelegramOrderRedisRateLimiter({
    sendCommand: async () => [11, 42_000],
  });
  assert.deepEqual(await exceeded.assess('100200300'), { allowed: false, retryAfterMs: 42_000 });
  const unavailable = createTelegramOrderRedisRateLimiter({
    sendCommand: async () => { throw new Error('redis unavailable'); },
  });
  assert.deepEqual(await unavailable.assess('100200300'), { allowed: false, retryAfterMs: 60_000 });
  assert.deepEqual(await unavailable.assess('invalid'), { allowed: false, retryAfterMs: 60_000 });
});
