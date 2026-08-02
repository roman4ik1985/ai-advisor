import assert from 'node:assert/strict';
import test from 'node:test';
import {
  inspectTelegramTestBotEnvironment,
  runTelegramTestBotAcceptance,
} from '../scripts/validate-telegram-test-bot.mjs';

const environment = {
  VALKEY_AIVEN_TEST_URL: 'rediss://acceptance-user:secret@example.invalid:12345',
  TELEGRAM_TEST_BOT_TOKEN: '123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghi',
  TELEGRAM_TEST_CHAT_ID: '100200300',
  TELEGRAM_ORDER_ENABLED: 'false',
};

test('preflight reports names only and requires TLS while production stays disabled', () => {
  assert.deepEqual(inspectTelegramTestBotEnvironment({}), {
    status: 'BLOCKED',
    mode: 'preflight',
    required: ['VALKEY_AIVEN_TEST_URL', 'TELEGRAM_TEST_BOT_TOKEN', 'TELEGRAM_TEST_CHAT_ID'],
    missing: ['VALKEY_AIVEN_TEST_URL', 'TELEGRAM_TEST_BOT_TOKEN', 'TELEGRAM_TEST_CHAT_ID'],
    invalid: [],
    tlsValkeyRequired: true,
    productionEnabled: false,
    salesdriveRequired: false,
    secretValuesPrinted: false,
  });
  assert.equal(inspectTelegramTestBotEnvironment({ ...environment, VALKEY_AIVEN_TEST_URL: 'redis://host' }).status, 'BLOCKED');
  assert.equal(inspectTelegramTestBotEnvironment({ ...environment, TELEGRAM_ORDER_ENABLED: 'true' }).status, 'BLOCKED');
  assert.equal(inspectTelegramTestBotEnvironment(environment).status, 'READY');
});

test('isolated acceptance uses Valkey, signed webhook, outbox and Telegram without order reads', async () => {
  const calls = { connected: 0, closed: 0, sent: [], deleted: 0 };
  const redis = {
    async connect() { calls.connected += 1; },
    async close() { calls.closed += 1; },
    async sendCommand(args) {
      if (args[0] === 'DEL') { calls.deleted += args.length - 1; return args.length - 1; }
      if (args[0] === 'EXISTS') return 0;
      throw new Error(`unexpected command ${args[0]}`);
    },
  };
  let webhookCall = 0;
  const result = await runTelegramTestBotAcceptance({
    environment,
    adapters: {
      randomBytesFn(size) { return Buffer.alloc(size, 7); },
      async createRedisClient() { return redis; },
      createStateStore() { return {}; },
      createRateLimiter() { return {}; },
      createWebhook({ orderService }) {
        assert.equal(typeof orderService.listOwnedOrders, 'function');
        return {
          async handle() {
            webhookCall += 1;
            return [
              { code: 'WEBHOOK_UNAUTHORIZED' },
              { code: 'ORDER_NOT_AVAILABLE' },
              { code: 'WEBHOOK_DUPLICATE' },
              { code: 'RATE_LIMITED' },
            ][webhookCall - 1];
          },
        };
      },
      createSender() {
        return { async dispatch(action) { calls.sent.push(action); return true; } };
      },
      createOutbox({ dispatch }) {
        let action;
        return {
          async enqueue(input) { action = input.action; return true; },
          async drainOne() {
            return await dispatch(action)
              ? { status: 'DELIVERED' }
              : { status: 'RETRY_SCHEDULED' };
          },
        };
      },
    },
  });

  assert.equal(result.status, 'PASS');
  assert.equal(result.salesdriveRequests, 0);
  assert.equal(result.productionEnabled, false);
  assert.equal(result.freeTextOrderLookup, false);
  assert.equal(result.aiUsed, false);
  assert.equal(calls.connected, 1);
  assert.equal(calls.closed, 1);
  assert.equal(calls.sent.length, 1);
  assert.equal(calls.sent[0].replyMarkup.inlineKeyboard.length, 6);
  assert.equal(calls.deleted, 6);
  assert.equal(JSON.stringify(result).includes('secret'), true);
  assert.equal(JSON.stringify(result).includes(environment.TELEGRAM_TEST_BOT_TOKEN), false);
  assert.equal(JSON.stringify(result).includes(environment.VALKEY_AIVEN_TEST_URL), false);
  assert.equal(JSON.stringify(result).includes(environment.TELEGRAM_TEST_CHAT_ID), false);
});
