import assert from 'node:assert/strict';
import test from 'node:test';
import { renderDeterministicLiveAnswer } from '../live-response-renderer.mjs';
import { executeRequestPipeline } from '../request-pipeline.mjs';

const inStockCatalog = [{
  sku: 'sku-1',
  name: 'Projector One',
  prices: ['13 599 грн.'],
  availability: { state: 'IN_STOCK' },
}];

test('deterministically renders confirmed inventory with matching price', () => {
  const answer = renderDeterministicLiveAnswer({
    question: 'Яка ціна та чи є в наявності?',
    route: { requiredResolvers: ['catalog', 'price', 'inventory'] },
    catalog: inStockCatalog,
    liveFacts: { inventory: [{ sku: 'sku-1', availability: { state: 'IN_STOCK' } }] },
  });

  assert.equal(answer, 'За даними SalesDrive, Projector One: є в наявності. Ціна: 13 599 грн.');
});

test('deterministically renders only delivery methods without a deadline', () => {
  const answer = renderDeterministicLiveAnswer({
    question: 'Які способи доставки доступні?',
    route: { requiredResolvers: ['catalog', 'inventory', 'delivery'] },
    liveFacts: { deliveryMethods: [{ id: '1', label: 'Нова пошта' }, { id: '2', label: 'Самовивіз' }] },
  });

  assert.equal(answer, 'Доступні способи доставки: Нова пошта, Самовивіз. Точний строк доставки уточнить менеджер.');
  assert.doesNotMatch(answer, /завтра|дн\w*|годин/iu);
});

test('does not render inventory without explicit matching stock evidence', () => {
  const answer = renderDeterministicLiveAnswer({
    question: 'Есть ли в наличии?',
    route: { requiredResolvers: ['catalog', 'inventory'] },
    catalog: inStockCatalog,
    liveFacts: { inventory: [] },
  });

  assert.equal(answer, null);
});

test('keeps a delivery-deadline question on the validator path', () => {
  const answer = renderDeterministicLiveAnswer({
    question: 'Доставите завтра?',
    route: { requiredResolvers: ['delivery'] },
    liveFacts: { deliveryMethods: [{ id: '1', label: 'Нова пошта' }] },
  });

  assert.equal(answer, null);
});

test('pipeline returns confirmed inventory without calling the model', async () => {
  const result = await executeRequestPipeline({
    question: 'Яка ціна та чи є в наявності?',
    messages: [{ role: 'user', content: 'Яка ціна та чи є в наявності?' }],
    querySalesdriveCatalog: async () => ({
      products: inStockCatalog,
      diagnostics: { code: 'OK' },
      source: 'salesdrive_yml',
      fetchedAt: new Date().toISOString(),
    }),
    queryCatalog: async () => { throw new Error('not expected'); },
    querySalesdriveDelivery: async () => { throw new Error('not expected'); },
    queryKnowledge: async () => [],
    buildPrompt: () => 'unused',
    askSupport: async () => { throw new Error('model must not be called'); },
    askVerifier: async () => { throw new Error('verifier must not be called'); },
  });

  assert.equal(result.answer, 'За даними SalesDrive, Projector One: є в наявності. Ціна: 13 599 грн.');
  assert.deepEqual(result.verification, { status: 'SKIPPED', reason: 'DETERMINISTIC_LIVE_FACT' });
  assert.equal(result.validation.accepted, true);
});
