import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('provisioning sources contain no AI, logging, write API, or public PII fields', async () => {
  const files = ['salesdrive-order-provisioning.mjs', 'telegram-order-provisioning.mjs'];
  const source = (await Promise.all(files.map((file) => (
    readFile(new URL(`../${file}`, import.meta.url), 'utf8')
  )))).join('\n');
  assert.doesNotMatch(source, /openai|prompt|model context|console\./iu);
  assert.doesNotMatch(source, /method:\s*'(POST|PUT|PATCH|DELETE)'/u);
  assert.doesNotMatch(source, /button:.*(phone|customerRef|sourceOrderId)/isu);
});
