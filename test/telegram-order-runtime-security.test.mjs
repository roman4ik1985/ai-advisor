import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const ROOT = new URL('../', import.meta.url);

test('runtime-source contour has no AI, prompt, SQL, outbound Telegram, or secret logging', async () => {
  const files = [
    'telegram-order-redis-store.mjs',
    'telegram-order-redis-rate-limit.mjs',
    'telegram-order-webhook.mjs',
  ];
  const source = (await Promise.all(files.map((file) => readFile(new URL(file, ROOT), 'utf8')))).join('\n');
  assert.doesNotMatch(source, /openai|chatgpt|language model|llm|intent-engine|buildPrompt/iu);
  assert.doesNotMatch(source, /fetch\s*\(|https:\/\/api\.telegram|sendMessage\s*\(\s*['"]https/iu);
  assert.doesNotMatch(source, /console\.(log|info|warn|error)/u);
  assert.doesNotMatch(source, /\b(SELECT|INSERT|UPDATE|DELETE)\b.*\b(FROM|INTO|SET)\b/iu);
});

test('webhook source accepts platform start command but has no free-text order parser', async () => {
  const source = await readFile(new URL('telegram-order-webhook.mjs', ROOT), 'utf8');
  assert.match(source, /\^\\\/start/u);
  assert.doesNotMatch(source, /intent|question|naturalLanguage|message\?\.text.*order/iu);
});

test('Redis state uses NX, GETDEL, expiry, and an atomic binding script', async () => {
  const source = await readFile(new URL('telegram-order-redis-store.mjs', ROOT), 'utf8');
  assert.match(source, /'NX'/u);
  assert.match(source, /'GETDEL'/u);
  assert.match(source, /'PX'/u);
  assert.match(source, /COMPLETE_BINDING_SCRIPT/u);
});
