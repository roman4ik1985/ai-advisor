import test from 'node:test';
import assert from 'node:assert/strict';
import { createTelegramOrderRuntime } from '../telegram-order-runtime.mjs';

const config = {
  telegramOrderEnabled: true,
  telegramOrderRedisUrl: 'redis://127.0.0.1:6379',
  telegramOrderWebhookSecret: 'synthetic_webhook_secret_123',
  telegramOrderBotToken: '123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghi',
  telegramOrderManagerChatId: '900800700',
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

test('runtime durably enqueues transport actions before acknowledging an update', async () => {
  const queued = [];
  let drained = 0;
  let timerCleared = false;
  const runtime = await createTelegramOrderRuntime({
    config,
    createRedisClient: () => ({
      async connect() {},
      async sendCommand(args) {
        if (args[0] === 'SET') return 'OK';
        if (args[0] === 'GET') return null;
        throw new Error(`unexpected Redis command: ${args[0]}`);
      },
      async close() {},
    }),
    createOrderClient: () => ({
      configured: true,
      async listOwnedOrders() { return { orders: [] }; },
      async getOwnedOrder() { return { ok: false }; },
    }),
    createSender: () => ({ async dispatch() { return true; } }),
    createActionSink: () => ({ async dispatch() { return true; } }),
    createOutbox: () => ({
      async enqueue(delivery) {
        queued.push(delivery);
        return true;
      },
      async drain() {
        drained += 1;
        return [];
      },
    }),
    setIntervalFn: () => ({ unref() {} }),
    clearIntervalFn: () => { timerCleared = true; },
  });
  const result = await runtime.handle({
    secretHeader: config.telegramOrderWebhookSecret,
    update: {
      update_id: 42,
      message: {
        from: { id: 100200300 },
        chat: { id: 100200300, type: 'private' },
        text: '/start invalid',
      },
    },
  });
  assert.deepEqual(result, { httpStatus: 200, body: { ok: true } });
  assert.equal(queued.length, 1);
  assert.equal(queued[0].deliveryId, 'telegram-update:42:0:SEND_MESSAGE');
  assert.equal(drained, 1);
  await runtime.close();
  assert.equal(timerCleared, true);
});
