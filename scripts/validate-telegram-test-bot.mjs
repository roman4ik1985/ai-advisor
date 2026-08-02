import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createTelegramOrderRedisClient } from '../telegram-order-redis-client.mjs';
import { createTelegramOrderRedisStore } from '../telegram-order-redis-store.mjs';
import { createTelegramOrderRedisRateLimiter } from '../telegram-order-redis-rate-limit.mjs';
import { createTelegramOrderWebhook } from '../telegram-order-webhook.mjs';
import { TELEGRAM_ORDER_MENU } from '../telegram-order-menu.mjs';
import { createTelegramOrderOutbox } from '../telegram-order-outbox.mjs';
import { createTelegramOrderSender } from '../telegram-order-sender.mjs';

const REQUIRED = Object.freeze([
  'VALKEY_AIVEN_TEST_URL',
  'TELEGRAM_TEST_BOT_TOKEN',
  'TELEGRAM_TEST_CHAT_ID',
]);
const BOT_TOKEN = /^\d{6,12}:[A-Za-z0-9_-]{30,100}$/u;
const TELEGRAM_ID = /^[1-9]\d{0,19}$/u;

export function inspectTelegramTestBotEnvironment(environment = process.env) {
  const missing = REQUIRED.filter((name) => !String(environment[name] ?? '').trim());
  const invalid = [];
  if (environment.VALKEY_AIVEN_TEST_URL && !isTlsValkeyUrl(environment.VALKEY_AIVEN_TEST_URL)) {
    invalid.push('VALKEY_AIVEN_TEST_URL');
  }
  if (environment.TELEGRAM_TEST_BOT_TOKEN && !BOT_TOKEN.test(String(environment.TELEGRAM_TEST_BOT_TOKEN).trim())) {
    invalid.push('TELEGRAM_TEST_BOT_TOKEN');
  }
  if (environment.TELEGRAM_TEST_CHAT_ID && !TELEGRAM_ID.test(String(environment.TELEGRAM_TEST_CHAT_ID).trim())) {
    invalid.push('TELEGRAM_TEST_CHAT_ID');
  }
  const productionEnabled = String(environment.TELEGRAM_ORDER_ENABLED ?? '').trim().toLowerCase() === 'true';
  return Object.freeze({
    status: missing.length || invalid.length || productionEnabled ? 'BLOCKED' : 'READY',
    mode: 'preflight',
    required: REQUIRED,
    missing: Object.freeze(missing),
    invalid: Object.freeze(invalid),
    tlsValkeyRequired: true,
    productionEnabled,
    salesdriveRequired: false,
    secretValuesPrinted: false,
  });
}

export async function runTelegramTestBotAcceptance({
  environment = process.env,
  adapters = {},
} = {}) {
  const preflight = inspectTelegramTestBotEnvironment(environment);
  if (preflight.status !== 'READY') throw acceptanceError('TELEGRAM_TEST_BOT_PREFLIGHT_BLOCKED');

  const createRedisClient = adapters.createRedisClient ?? createTelegramOrderRedisClient;
  const createStateStore = adapters.createStateStore ?? createTelegramOrderRedisStore;
  const createRateLimiter = adapters.createRateLimiter ?? createTelegramOrderRedisRateLimiter;
  const createWebhook = adapters.createWebhook ?? createTelegramOrderWebhook;
  const createSender = adapters.createSender ?? createTelegramOrderSender;
  const createOutbox = adapters.createOutbox ?? createTelegramOrderOutbox;
  const entropy = adapters.randomBytesFn ?? randomBytes;
  const runId = entropy(8).toString('hex');
  const statePrefix = `aiadvisor:accept:telegram:${runId}:state`;
  const ratePrefix = `aiadvisor:accept:telegram:${runId}:rate`;
  const outboxPrefix = `aiadvisor:accept:telegram:${runId}:outbox`;
  const chatId = String(environment.TELEGRAM_TEST_CHAT_ID).trim();
  const updateId = Number.parseInt(runId.slice(0, 12), 16);
  const deliveryId = `telegram-accept:${runId}:menu`;
  const cleanupKeys = [
    `${statePrefix}:update:${updateId}`,
    `${statePrefix}:update:${updateId + 1}`,
    `${ratePrefix}:${chatId}`,
    `${outboxPrefix}:due`,
    `${outboxPrefix}:record:${deliveryId}`,
    `${outboxPrefix}:dead:${deliveryId}`,
  ];
  const redis = await createRedisClient({ url: String(environment.VALKEY_AIVEN_TEST_URL).trim() });
  let connected = false;
  let cleanupPassed = false;
  let orderReads = 0;

  try {
    await redis.connect();
    connected = true;
    const stateStore = createStateStore({ sendCommand: redis.sendCommand, prefix: statePrefix });
    const rateLimiter = createRateLimiter({
      sendCommand: redis.sendCommand,
      prefix: ratePrefix,
      limit: 1,
      windowMs: 60_000,
    });
    const orderService = Object.freeze({
      async listOwnedOrders() { orderReads += 1; throw acceptanceError('SALESDRIVE_ACCESS_FORBIDDEN'); },
      async getOwnedOrder() { orderReads += 1; throw acceptanceError('SALESDRIVE_ACCESS_FORBIDDEN'); },
    });
    const webhookSecret = entropy(24).toString('base64url');
    const webhook = createWebhook({ secretToken: webhookSecret, stateStore, rateLimiter, orderService });
    const update = freeTextUpdate(updateId, chatId);
    const unauthorized = await webhook.handle({ secretHeader: 'invalid_acceptance_secret', update });
    const accepted = await webhook.handle({ secretHeader: webhookSecret, update });
    const duplicate = await webhook.handle({ secretHeader: webhookSecret, update });
    const limited = await webhook.handle({
      secretHeader: webhookSecret,
      update: freeTextUpdate(updateId + 1, chatId),
    });
    if (
      unauthorized?.code !== 'WEBHOOK_UNAUTHORIZED'
      || accepted?.code !== 'ORDER_NOT_AVAILABLE'
      || duplicate?.code !== 'WEBHOOK_DUPLICATE'
      || limited?.code !== 'RATE_LIMITED'
      || orderReads !== 0
    ) {
      throw acceptanceError('SIGNED_WEBHOOK_ACCEPTANCE_FAILED');
    }

    const sender = createSender({ botToken: String(environment.TELEGRAM_TEST_BOT_TOKEN).trim() });
    const outbox = createOutbox({
      sendCommand: redis.sendCommand,
      prefix: outboxPrefix,
      dispatch: (action) => sender.dispatch(action),
    });
    const queued = await outbox.enqueue({ deliveryId, action: acceptanceMenuAction(chatId) });
    const delivery = queued ? await outbox.drainOne() : null;
    if (!queued || delivery?.status !== 'DELIVERED') {
      throw acceptanceError('TELEGRAM_MENU_DELIVERY_FAILED');
    }

    await redis.sendCommand(['DEL', ...cleanupKeys]);
    cleanupPassed = Number(await redis.sendCommand(['EXISTS', ...cleanupKeys])) === 0;
    if (!cleanupPassed) throw acceptanceError('TELEGRAM_ACCEPTANCE_CLEANUP_FAILED');

    return Object.freeze({
      status: 'PASS',
      mode: 'live-isolated',
      tlsValkey: 'PASS',
      telegramMenuTransport: 'PASS',
      signedWebhook: 'PASS',
      unauthorizedWebhook: 'PASS',
      duplicateProtection: 'PASS',
      distributedRateLimit: 'PASS',
      outboxDelivery: 'PASS',
      redisCleanup: 'PASS',
      salesdriveRequests: orderReads,
      productionEnabled: false,
      freeTextOrderLookup: false,
      aiUsed: false,
      secretValuesPrinted: false,
    });
  } finally {
    if (connected && !cleanupPassed) {
      try { await redis.sendCommand(['DEL', ...cleanupKeys]); } catch { /* best-effort bounded cleanup */ }
    }
    try { await redis.close(); } catch { /* no secret-bearing error output */ }
  }
}

function acceptanceMenuAction(chatId) {
  return Object.freeze({
    type: 'SEND_MESSAGE',
    chatId,
    text: 'AI Advisor: ізольована перевірка menu-only Telegram transport.',
    replyMarkup: Object.freeze({
      inlineKeyboard: Object.freeze(TELEGRAM_ORDER_MENU.map((item) => Object.freeze([Object.freeze({
        text: item.text,
        callbackData: item.callbackData,
      })]))),
    }),
  });
}

function freeTextUpdate(updateId, chatId) {
  const numericId = Number(chatId);
  return {
    update_id: updateId,
    message: {
      from: { id: numericId },
      chat: { id: numericId, type: 'private' },
      text: 'acceptance free text must not read orders',
    },
  };
}

function isTlsValkeyUrl(value) {
  try {
    const parsed = new URL(String(value).trim());
    return parsed.protocol === 'rediss:' && Boolean(parsed.hostname) && Boolean(parsed.password);
  } catch {
    return false;
  }
}

function acceptanceError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

async function main() {
  const mode = String(process.argv[2] ?? 'preflight').trim().toLowerCase();
  if (mode === 'preflight') {
    console.log(JSON.stringify(inspectTelegramTestBotEnvironment()));
    return;
  }
  if (mode !== 'live') throw acceptanceError('MODE_MUST_BE_PREFLIGHT_OR_LIVE');
  console.log(JSON.stringify(await runTelegramTestBotAcceptance()));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(JSON.stringify({
      status: 'FAIL',
      code: String(error?.code ?? 'TELEGRAM_TEST_BOT_ACCEPTANCE_FAILED'),
      secretValuesPrinted: false,
    }));
    process.exitCode = 1;
  });
}
