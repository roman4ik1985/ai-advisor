import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('server wires a fixed disabled-by-default Telegram webhook route', async () => {
  const server = await readFile(new URL('../server.mjs', import.meta.url), 'utf8');
  const config = await readFile(new URL('../src/config.mjs', import.meta.url), 'utf8');
  assert.match(server, /createTelegramOrderRuntime/u);
  assert.match(server, /x-telegram-bot-api-secret-token/u);
  assert.match(server, /telegramOrderWebhookPath/u);
  assert.match(config, /'\/api\/telegram\/order-webhook'/u);
  assert.match(config, /TELEGRAM_ORDER_ENABLED/u);
});
