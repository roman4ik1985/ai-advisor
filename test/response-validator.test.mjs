import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { validateAssistantAnswer } from '../response-validator.mjs';

const freshCatalog = { catalog: { queried: true, code: 'OK', fetchedAt: '2026-07-28T10:00:00Z' } };
const freshKnowledge = { knowledge: { maxAgeDays: 180 } };
const validationNow = () => new Date('2026-07-28T10:05:00Z');

test('response validator keeps a catalog-backed price', () => {
  const result = validateAssistantAnswer({
    answer: 'Ціна Xiaomi Wanbo T6 Max — 13 599 грн.',
    catalog: [{ prices: ['13 599 грн.'] }],
    question: 'Яка ціна?',
    freshness: freshCatalog,
    now: validationNow,
  });

  assert.deepEqual(result, {
    accepted: true,
    action: 'ALLOW',
    answer: 'Ціна Xiaomi Wanbo T6 Max — 13 599 грн.',
    reasons: [],
  });
});

test('response validator replaces an unsupported price with a language-aware fallback', () => {
  const result = validateAssistantAnswer({
    answer: 'Цена — 15 000 грн.',
    catalog: [{ prices: ['13 599 грн.'] }],
    question: 'Какая цена?',
    freshness: freshCatalog,
    now: validationNow,
  });

  assert.equal(result.accepted, false);
  assert.equal(result.action, 'REWRITE');
  assert.deepEqual(result.reasons, ['UNVERIFIED_PRICE']);
  assert.match(result.answer, /^Чтобы не дать неточную информацию/u);
});

test('response validator blocks availability and promised delivery without a live source', () => {
  const result = validateAssistantAnswer({
    answer: 'Товар есть в наличии, доставим завтра.',
    question: 'Можно заказать?',
  });

  assert.equal(result.accepted, false);
  assert.equal(result.action, 'ESCALATE');
  assert.deepEqual(result.reasons, ['UNVERIFIED_AVAILABILITY', 'UNVERIFIED_DELIVERY_DEADLINE']);
});

test('response validator accepts a warranty term only when knowledge supports it', () => {
  const result = validateAssistantAnswer({
    answer: 'Гарантия составляет 24 месяца.',
    knowledge: [{ title: 'Гарантия', text: 'На проекторы действует гарантия 24 месяца.', reviewedAt: '2026-07-23' }],
    question: 'Какая гарантия?',
    freshness: freshKnowledge,
    now: validationNow,
  });

  assert.equal(result.accepted, true);
  assert.equal(result.action, 'ALLOW');
});

test('response validator blocks a warranty term that knowledge does not support', () => {
  const result = validateAssistantAnswer({
    answer: 'Гарантія становить 36 місяців.',
    knowledge: [{ title: 'Гарантія', text: 'На проектори діє гарантія 24 місяці.', reviewedAt: '2026-07-23' }],
    question: 'Яка гарантія?',
    freshness: freshKnowledge,
    now: validationNow,
  });

  assert.equal(result.accepted, false);
  assert.equal(result.action, 'REWRITE');
  assert.deepEqual(result.reasons, ['UNVERIFIED_WARRANTY_TERM']);
  assert.match(result.answer, /^Щоб не надати неточну інформацію/u);
});

test('response validator rejects a catalog price without fresh catalog evidence', () => {
  const result = validateAssistantAnswer({
    answer: 'Цена — 13 599 грн.',
    catalog: [{ prices: ['13 599 грн.'] }],
    question: 'Какая цена?',
    now: validationNow,
  });

  assert.equal(result.accepted, false);
  assert.equal(result.action, 'REWRITE');
  assert.deepEqual(result.reasons, ['UNVERIFIED_PRICE']);
});

test('response validator rejects a warranty term from stale knowledge', () => {
  const result = validateAssistantAnswer({
    answer: 'Гарантія становить 24 місяці.',
    knowledge: [{ title: 'Гарантія', text: 'Гарантія 24 місяці.', reviewedAt: '2025-01-01' }],
    freshness: freshKnowledge,
    question: 'Яка гарантія?',
    now: validationNow,
  });

  assert.equal(result.accepted, false);
  assert.equal(result.action, 'REWRITE');
  assert.deepEqual(result.reasons, ['UNVERIFIED_WARRANTY_TERM']);
});

test('test-only provider returns the fallback without changing the successful chat contract', async (context) => {
  const port = await getAvailablePort();
  const child = spawn(process.execPath, ['server.mjs', '--provider=test'], {
    cwd: new URL('..', import.meta.url),
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PORT: String(port),
      RATE_LIMIT_PER_MINUTE: '20',
      AI_TEST_PROVIDER_DELAY_MS: '10',
      AI_TEST_PROVIDER_RESPONSE: 'Товар есть в наличии.',
    },
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true,
  });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  context.after(() => {
    if (child.exitCode === null) child.kill();
  });

  await waitUntilReady(port, child, () => stderr);
  const response = await fetch(`http://127.0.0.1:${port}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'Есть ли товар?' }] }),
  });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(Object.keys(payload).sort(), ['answer', 'catalog', 'catalogDiagnostics', 'knowledge', 'provider']);
  assert.equal(payload.provider, 'test');
  assert.match(payload.answer, /^Чтобы не дать неточную информацию/u);

  const faqResponse = await fetch(`http://127.0.0.1:${port}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'Какие способы оплаты?' }] }),
  });
  const faqPayload = await faqResponse.json();
  assert.equal(faqResponse.status, 200);
  assert.equal(faqPayload.catalogDiagnostics.code, 'SKIPPED_BY_ROUTE');
  assert.deepEqual(faqPayload.catalog, []);
});

async function getAvailablePort() {
  const probe = createServer();
  await new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', resolve);
  });
  const { port } = probe.address();
  await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function waitUntilReady(port, child, getStderr) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Test server exited early (${child.exitCode}): ${getStderr()}`);
    try {
      if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) return;
    } catch {
      // The isolated test server may still be binding the loopback port.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Test server did not become ready: ${getStderr()}`);
}
