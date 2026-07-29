import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('server exposes a fixed rate-limited CORS-protected provisioning route only with runtime enabled', async () => {
  const source = await readFile(new URL('../server.mjs', import.meta.url), 'utf8');
  assert.match(source, /\/api\/telegram\/order-link/u);
  assert.match(source, /telegramOrderRuntime\.provision/u);
  assert.match(source, /telegram-link:/u);
  assert.match(source, /applyCors\(request, response\)/u);
});

test('widget creates the Telegram button through DOM APIs and validates t.me', async () => {
  const source = await readFile(new URL('../public/widget.js', import.meta.url), 'utf8');
  assert.match(source, /Перевірити в Telegram/u);
  assert.match(source, /\/api\/telegram\/order-link/u);
  assert.match(source, /url\.hostname === 't\.me'/u);
  assert.match(source, /document\.createElement\('a'\)/u);
  assert.doesNotMatch(source, /innerHTML\s*=.*payload/iu);
});
