import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('outbox and action sinks are allow-listed, Redis-backed, and AI-free', async () => {
  const [outbox, sink, runtime] = await Promise.all([
    readFile(new URL('../telegram-order-outbox.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../telegram-order-action-sink.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../telegram-order-runtime.mjs', import.meta.url), 'utf8'),
  ]);
  assert.match(outbox, /ZRANGEBYSCORE/u);
  assert.match(outbox, /HINCRBY/u);
  assert.match(outbox, /ZREM/u);
  assert.match(runtime, /telegram-update:/u);
  assert.match(sink, /REQUEST_MANAGER/u);
  assert.match(sink, /OPEN_NOTIFICATION_SETTINGS/u);
  assert.doesNotMatch(`${outbox}\n${sink}`, /OPENAI_API_KEY|askViaApi|fetch\s*\(/u);
  assert.doesNotMatch(sink, /phone|address|email|conversation|history/iu);
});
