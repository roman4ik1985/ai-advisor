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

test('deterministically renders bilingual price-only questions', () => {
  assert.equal(renderDeterministicLiveAnswer({
    question: 'Какая цена Projector One?',
    route: { requiredResolvers: ['catalog', 'price'] },
    catalog: inStockCatalog,
  }), 'По данным SalesDrive, цена Projector One: 13 599 грн.');

  assert.equal(renderDeterministicLiveAnswer({
    question: 'Яка ціна Projector One?',
    route: { requiredResolvers: ['catalog', 'price'] },
    catalog: inStockCatalog,
  }), 'За даними SalesDrive, ціна Projector One: 13 599 грн.');
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

test('does not choose an arbitrary product for an ambiguous inventory question', () => {
  const second = {
    sku: 'sku-2',
    name: 'Projector Two',
    prices: ['14 999 грн.'],
    availability: { state: 'IN_STOCK' },
  };
  const facts = [
    { sku: 'sku-1', availability: { state: 'IN_STOCK' } },
    { sku: 'sku-2', availability: { state: 'IN_STOCK' } },
  ];

  const ambiguous = renderDeterministicLiveAnswer({
    question: 'Какие проекторы есть в наличии?',
    route: { requiredResolvers: ['catalog', 'inventory'] },
    catalog: [inStockCatalog[0], second],
    liveFacts: { inventory: facts },
  });
  assert.match(ambiguous, /Уточните.*модель или артикул/iu);
  assert.doesNotMatch(ambiguous, /Projector One|Projector Two/u);

  assert.match(renderDeterministicLiveAnswer({
    question: 'Есть ли Projector Two в наличии?',
    route: { requiredResolvers: ['catalog', 'inventory'] },
    catalog: [inStockCatalog[0], second],
    liveFacts: { inventory: facts },
  }), /Projector Two/u);
});

test('chooses the most specific full-name match when names are nested', () => {
  const specific = { ...inStockCatalog[0], sku: 'sku-pro', name: 'Projector One Pro' };
  const facts = [
    { sku: 'sku-1', availability: { state: 'IN_STOCK' } },
    { sku: 'sku-pro', availability: { state: 'IN_STOCK' } },
  ];
  const answer = renderDeterministicLiveAnswer({
    question: 'Есть ли Projector One Pro в наличии?',
    route: { requiredResolvers: ['catalog', 'inventory'] },
    catalog: [inStockCatalog[0], specific],
    liveFacts: { inventory: facts },
  });

  assert.match(answer, /Projector One Pro/u);
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
