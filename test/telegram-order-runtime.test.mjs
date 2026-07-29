import test from 'node:test';
import assert from 'node:assert/strict';
import { createTelegramOrderRuntime } from '../telegram-order-runtime.mjs';

const config = {
  telegramOrderEnabled: true,
  telegramOrderRedisUrl: 'redis://127.0.0.1:6379',
  telegramOrderWebhookSecret: 'synthetic_webhook_secret_123',
  telegramOrderBotToken: '123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghi',
  telegramOrderRateLimit: 10,
};

test('runtime remains completely disabled without the feature flag', async () => {
  assert.equal(await createTelegramOrderRuntime({
    config: { telegramOrderEnabled: false },
    createRedisClient: () => { throw new Error('must not initialize'); },
  }), null);
});

test('runtime connects injected adapters and unauthorized webhook causes no Telegram call', async () => {
  let connected = false;
  let closed = false;
  let sent = 0;
  const runtime = await createTelegramOrderRuntime({
    config,
    createRedisClient: () => ({
      async connect() { connected = true; },
      async sendCommand() { throw new Error('must not access Redis for rejected secret'); },
      async close() { closed = true; },
    }),
    createOrderClient: () => ({ configured: true, getOwnedOrder: async () => ({ ok: false }) }),
    createSender: () => ({
      async dispatch() { sent += 1; return true; },
    }),
  });
  assert.equal(connected, true);
  const response = await runtime.handle({
    secretHeader: 'wrong_secret_value',
    update: { update_id: 1, callback_query: { id: 'forged' } },
  });
  assert.deepEqual(response, { httpStatus: 401, body: { ok: false } });
  assert.equal(sent, 0);
  await runtime.close();
  assert.equal(closed, true);
});

test('enabled runtime rejects missing server-side configuration before connecting', async () => {
  await assert.rejects(
    createTelegramOrderRuntime({
      config: { ...config, telegramOrderBotToken: '' },
      createRedisClient: () => { throw new Error('must not connect'); },
    }),
    /TELEGRAM_ORDER_BOT_TOKEN_REQUIRED/,
  );
});
