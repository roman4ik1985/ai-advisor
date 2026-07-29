import test from 'node:test';
import assert from 'node:assert/strict';
import { createTelegramOrderRedisClient } from '../telegram-order-redis-client.mjs';

test('Redis client connects, delegates frozen commands, and closes without exposing URL', async () => {
  const calls = [];
  const raw = {
    isOpen: false,
    on() {},
    async connect() { this.isOpen = true; },
    async sendCommand(args) { calls.push(args); return 'OK'; },
    async close() { this.isOpen = false; },
  };
  const client = await createTelegramOrderRedisClient({
    url: 'rediss://user:secret@redis.example.test:6380/0',
    createClientImpl(options) {
      assert.equal(options.url, 'rediss://user:secret@redis.example.test:6380/0');
      return raw;
    },
  });
  await assert.rejects(client.sendCommand(['PING']), /NOT_CONNECTED/);
  await client.connect();
  assert.equal(await client.sendCommand(Object.freeze(['SET', 'key', 'value'])), 'OK');
  assert.deepEqual(calls, [['SET', 'key', 'value']]);
  await client.close();
  assert.equal(raw.isOpen, false);
});

test('Redis client rejects non-Redis URLs', async () => {
  for (const url of ['', 'https://example.test', 'redis://']) {
    await assert.rejects(createTelegramOrderRedisClient({
      url,
      createClientImpl() { throw new Error('must not create'); },
    }), /valid redis/iu);
  }
});
