import { resolve } from 'node:path';
import { buildCatalogSearchUrl } from './catalog.mjs';

export const projectRoot = resolve(import.meta.dirname, '..');

export function normalizeProvider(value, allowTestProvider = false) {
  const provider = String(value || 'cli').trim().toLowerCase();
  const allowedProviders = allowTestProvider ? ['cli', 'api', 'test'] : ['cli', 'api'];
  if (!allowedProviders.includes(provider)) {
    throw new Error(`Unsupported AI_PROVIDER: ${provider}. Use ${allowTestProvider ? 'cli, api or test' : 'cli or api'}.`);
  }
  return provider;
}

export function readConfig(argv = process.argv.slice(2), env = process.env) {
  const providerFlag = argv.find((item) => item.startsWith('--provider='));
  const provider = normalizeProvider(
    providerFlag?.split('=')[1] || env.AI_PROVIDER,
    env.NODE_ENV === 'test',
  );
  const host = provider === 'cli' ? '127.0.0.1' : (env.HOST || '127.0.0.1');
  const storeUrl = normalizeStoreUrl(env.STORE_URL || 'https://ledprojector.com.ua');

  return {
    provider,
    host,
    port: toInteger(env.PORT, 8787, 1, 65535),
    allowedOrigins: String(env.ALLOWED_ORIGINS || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
    apiKey: env.OPENAI_API_KEY || '',
    apiModel: env.OPENAI_MODEL || 'gpt-5.6-terra',
    apiReasoningEffort: env.OPENAI_REASONING_EFFORT || 'low',
    codexModel: env.CODEX_MODEL || '',
    codexTimeoutMs: toInteger(env.CODEX_TIMEOUT_MS, 90000, 10000, 180000),
    storeUrl,
    rateLimitPerMinute: toInteger(env.RATE_LIMIT_PER_MINUTE, 20, 1, 120),
    aiMaxConcurrent: toInteger(env.AI_MAX_CONCURRENT, 4, 1, 32),
    aiMaxQueue: toInteger(env.AI_MAX_QUEUE, 16, 0, 256),
    testProviderDelayMs: toInteger(env.AI_TEST_PROVIDER_DELAY_MS, 200, 10, 30000),
    shutdownTimeoutMs: toInteger(env.SHUTDOWN_TIMEOUT_MS, 30000, 1000, 120000),
    learningLogEnabled: toBoolean(env.LEARNING_LOG_ENABLED),
    learningLogPath: resolve(projectRoot, 'logs', normalizeLearningLogFile(env.LEARNING_LOG_FILE)),
    telegramOrderEnabled: toBoolean(env.TELEGRAM_ORDER_ENABLED),
    telegramOrderWebhookPath: '/api/telegram/order-webhook',
    telegramOrderWebhookSecret: String(env.TELEGRAM_ORDER_WEBHOOK_SECRET || ''),
    telegramOrderBotToken: String(env.TELEGRAM_ORDER_BOT_TOKEN || ''),
    telegramOrderRedisUrl: String(env.TELEGRAM_ORDER_REDIS_URL || ''),
    telegramOrderRateLimit: toInteger(env.TELEGRAM_ORDER_RATE_LIMIT_PER_MINUTE, 10, 1, 60),
  };
}

function normalizeStoreUrl(value) {
  const storeUrl = String(value || '').trim() || 'https://ledprojector.com.ua';
  buildCatalogSearchUrl(storeUrl, 'smoke');
  return new URL(storeUrl).origin;
}

function toInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function toBoolean(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function normalizeLearningLogFile(value) {
  const fileName = String(value || '').trim() || 'ai-advisor-learning.log';
  return /^[a-z0-9][a-z0-9._-]{0,120}$/iu.test(fileName) ? fileName : 'ai-advisor-learning.log';
}
