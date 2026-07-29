export async function createTelegramOrderRedisClient({
  url,
  createClientImpl,
} = {}) {
  const clientFactory = createClientImpl ?? (await import('redis')).createClient;
  const redisUrl = normalizeRedisUrl(url);
  if (!redisUrl || typeof clientFactory !== 'function') {
    throw new TypeError('A valid redis:// or rediss:// URL is required.');
  }
  const client = clientFactory({
    url: redisUrl,
    socket: {
      connectTimeout: 8_000,
      reconnectStrategy(retries) {
        return retries > 8 ? false : Math.min(100 * (2 ** retries), 3_000);
      },
    },
  });
  client.on?.('error', () => {});

  return Object.freeze({
    async connect() {
      if (!client.isOpen) await client.connect();
    },
    async sendCommand(args) {
      if (!client.isOpen) throw new Error('TELEGRAM_ORDER_REDIS_NOT_CONNECTED');
      return client.sendCommand([...args]);
    },
    async close() {
      if (client.isOpen) await client.close();
    },
  });
}

function normalizeRedisUrl(value) {
  try {
    const parsed = new URL(String(value ?? ''));
    return ['redis:', 'rediss:'].includes(parsed.protocol) && parsed.hostname
      ? parsed.toString()
      : null;
  } catch {
    return null;
  }
}
