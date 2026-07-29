import { createTelegramOrderRedisClient } from './telegram-order-redis-client.mjs';
import { createTelegramOrderRedisStore } from './telegram-order-redis-store.mjs';
import { createTelegramOrderRedisRateLimiter } from './telegram-order-redis-rate-limit.mjs';
import { createSalesdriveOrderClient } from './salesdrive-order-client.mjs';
import { createTelegramOwnedOrderService } from './telegram-owned-order-service.mjs';
import { createTelegramOrderWebhook } from './telegram-order-webhook.mjs';
import { createTelegramOrderSender } from './telegram-order-sender.mjs';

export async function createTelegramOrderRuntime({
  config,
  createRedisClient = createTelegramOrderRedisClient,
  createOrderClient = createSalesdriveOrderClient,
  createSender = createTelegramOrderSender,
  actionSink,
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

  async function handle({ secretHeader, update }) {
    const webhookResult = await webhook.handle({ secretHeader, update });
    const actions = [...webhookResult.actions];
    if (webhookResult.httpStatus === 200 && update?.callback_query?.id) {
      actions.unshift({
        type: 'ANSWER_CALLBACK',
        callbackQueryId: String(update.callback_query.id),
      });
    }
    for (const action of actions) {
      let dispatched;
      if (action.type === 'SEND_MESSAGE' || action.type === 'ANSWER_CALLBACK') {
        dispatched = await sender.dispatch(action);
      } else if (actionSink?.dispatch) {
        dispatched = await actionSink.dispatch(action);
      } else {
        dispatched = await sender.dispatch({
          type: 'SEND_MESSAGE',
          chatId: action.telegramUserId,
          text: 'Ця функція поки недоступна. Спробуйте пізніше.',
        });
      }
      if (dispatched !== true) {
        return Object.freeze({ httpStatus: 503, body: Object.freeze({ ok: false }) });
      }
    }
    return Object.freeze({
      httpStatus: webhookResult.httpStatus,
      body: Object.freeze({ ok: webhookResult.httpStatus < 400 }),
    });
  }

  return Object.freeze({
    handle,
    stateStore,
    async close() { await redis.close(); },
  });
}

function requireConfig(config) {
  for (const [key, value] of Object.entries({
    TELEGRAM_ORDER_REDIS_URL: config.telegramOrderRedisUrl,
    TELEGRAM_ORDER_WEBHOOK_SECRET: config.telegramOrderWebhookSecret,
    TELEGRAM_ORDER_BOT_TOKEN: config.telegramOrderBotToken,
  })) {
    if (!String(value ?? '').trim()) throw new Error(`${key}_REQUIRED`);
  }
}
