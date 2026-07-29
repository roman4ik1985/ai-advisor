import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const ROOT = new URL('../', import.meta.url);

test('C25 Telegram order package contains no AI/model/prompt dependency', async () => {
  const files = [
    'order-dto.mjs',
    'salesdrive-order-client.mjs',
    'telegram-order-menu.mjs',
  ];
  const source = (await Promise.all(files.map((file) => readFile(new URL(file, ROOT), 'utf8')))).join('\n');
  assert.doesNotMatch(source, /openai|chatgpt|language model|llm|prompt|intent-engine/iu);
});

test('C25 order source package contains no write HTTP method', async () => {
  const source = await readFile(new URL('salesdrive-order-client.mjs', ROOT), 'utf8');
  assert.match(source, /method:\s*'GET'/u);
  assert.doesNotMatch(source, /method:\s*'(POST|PUT|PATCH|DELETE)'/u);
});

test('C25 Telegram router has no free-text route', async () => {
  const source = await readFile(new URL('telegram-order-menu.mjs', ROOT), 'utf8');
  assert.match(source, /callback_query/u);
  assert.doesNotMatch(source, /message\?\.text|message\.text|entities|caption/u);
});

test('C25 bounded DTO source does not select forbidden raw fields', async () => {
  const source = await readFile(new URL('order-dto.mjs', ROOT), 'utf8');
  for (const forbiddenSelector of [
    'primaryContact',
    'contacts',
    'shipping_address',
    'streetName',
    'house',
    'flat',
    'costPrice',
    'profitAmount',
    'commissionAmount',
    'utmSource',
    'token',
  ]) {
    assert.equal(source.includes(`rawOrder.${forbiddenSelector}`), false, forbiddenSelector);
  }
});
