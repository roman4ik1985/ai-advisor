import { createTelegramOrderRedisClient } from './telegram-order-redis-client.mjs';
import { createTelegramOrderRedisStore } from './telegram-order-redis-store.mjs';
import { createTelegramOrderRedisRateLimiter } from './telegram-order-redis-rate-limit.mjs';
import { createSalesdriveOrderClient } from './salesdrive-order-client.mjs';
import { createTelegramOwnedOrderService } from './telegram-owned-order-service.mjs';
import { createTelegramOrderWebhook } from './telegram-order-webhook.mjs';
import { createTelegramOrderSender } from './telegram-order-sender.mjs';
import { createSalesdriveOrderProvisioningResolver } from './salesdrive-order-provisioning.mjs';
import { createTelegramOrderProvisioner } from './telegram-order-provisioning.mjs';
import { createTelegramOrderActionSink } from './telegram-order-action-sink.mjs';
import { createTelegramOrderOutbox } from './telegram-order-outbox.mjs';

export async function createTelegramOrderRuntime({
  config,
  createRedisClient = createTelegramOrderRedisClient,
  createOrderClient = createSalesdriveOrderClient,
  createSender = createTelegramOrderSender,
  createCandidateResolver = createSalesdriveOrderProvisioningResolver,
  createProvisioner = createTelegramOrderProvisioner,
  createActionSink = createTelegramOrderActionSink,
  createOutbox = createTelegramOrderOutbox,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
} = {}) {
  if (!config?.telegramOrderEnabled) return null;
  requireConfig(config);

  const redis = await createRedisClient({ url: config.telegramOrderRedisUrl });
  await redis.connect();
  const stateStore = createTelegramOrderRedisStore({ sendCommand: redis.sendCommand });
  const rateLimiter = createTelegramOrderRedisRateLimiter({
    sendCommand: redis.sendCommand,
    limit: config.telegramOrderRateLimit,
    windowMs: 60_000,
  });
  const orderClient = createOrderClient();
  if (!orderClient.configured) {
    await redis.close();
    throw new Error('TELEGRAM_ORDER_SALESDRIVE_NOT_CONFIGURED');
  }
  const orderService = createTelegramOwnedOrderService({ stateStore, orderClient });
  const webhook = createTelegramOrderWebhook({
    secretToken: config.telegramOrderWebhookSecret,
    stateStore,
    rateLimiter,
    orderService,
  });
  const sender = createSender({ botToken: config.telegramOrderBotToken });
  const actionSink = createActionSink({
    sender,
    stateStore,
    managerChatId: config.telegramOrderManagerChatId,
  });
  const dispatch = async (action) => {
    if (action.type === 'SEND_MESSAGE' || action.type === 'ANSWER_CALLBACK') {
      return sender.dispatch(action);
    }
    return actionSink.dispatch(action);
  };
  const outbox = createOutbox({ sendCommand: redis.sendCommand, dispatch });
  const timer = setIntervalFn(() => {
    void outbox.drain({ limit: 20 });
  }, 1_000);
  timer?.unref?.();
  async function provision(input) {
    const candidateResolver = createCandidateResolver();
    if (!candidateResolver.configured) throw new Error('TELEGRAM_ORDER_PROVISIONING_SOURCE_NOT_CONFIGURED');
    return createProvisioner({
      candidateResolver,
      stateStore,
      botUsername: config.telegramOrderBotUsername,
    }).provision(input);
  }

  async function handle({ secretHeader, update }) {
    const webhookResult = await webhook.handle({ secretHeader, update });
    const actions = [...webhookResult.actions];
    if (webhookResult.httpStatus === 200 && update?.callback_query?.id) {
      actions.unshift({
        type: 'ANSWER_CALLBACK',
        callbackQueryId: String(update.callback_query.id),
      });
    }
    for (let actionIndex = 0; actionIndex < actions.length; actionIndex += 1) {
      const action = actions[actionIndex];
      const queued = await outbox.enqueue({
        deliveryId: `telegram-update:${update.update_id}:${actionIndex}:${action.type}`,
        action,
      });
      if (!queued) {
        return Object.freeze({ httpStatus: 503, body: Object.freeze({ ok: false }) });
      }
    }
    if (actions.length) await outbox.drain({ limit: actions.length });
    return Object.freeze({
      httpStatus: webhookResult.httpStatus,
      body: Object.freeze({ ok: webhookResult.httpStatus < 400 }),
    });
  }

  return Object.freeze({
    handle,
    provision,
    drainOutbox: outbox.drain,
    stateStore,
    async close() {
      clearIntervalFn(timer);
      await redis.close();
    },
  });
}

function requireConfig(config) {
  for (const [key, value] of Object.entries({
    TELEGRAM_ORDER_REDIS_URL: config.telegramOrderRedisUrl,
    TELEGRAM_ORDER_WEBHOOK_SECRET: config.telegramOrderWebhookSecret,
    TELEGRAM_ORDER_BOT_TOKEN: config.telegramOrderBotToken,
    TELEGRAM_ORDER_MANAGER_CHAT_ID: config.telegramOrderManagerChatId,
  })) {
    if (!String(value ?? '').trim()) throw new Error(`${key}_REQUIRED`);
  }
}
