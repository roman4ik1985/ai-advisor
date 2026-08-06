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
const freshPriceEvidence = { status: 'AVAILABLE', freshness: 'FRESH', checkedAt: '2026-07-29T00:00:00Z' };
const freshInventoryEvidence = {
  status: 'AVAILABLE',
  freshness: 'FRESH',
  checkedAt: '2026-07-29T00:00:00Z',
  capabilities: ['stock'],
};
const freshDeliveryEvidence = {
  status: 'AVAILABLE',
  freshness: 'FRESH',
  checkedAt: '2026-07-29T00:00:00Z',
  capabilities: ['methods'],
};
const freshPaymentEvidence = {
  status: 'AVAILABLE',
  freshness: 'FRESH',
  checkedAt: '2026-07-29T00:00:00Z',
  capabilities: ['methods'],
};

test('deterministically renders confirmed inventory with matching price', () => {
  const answer = renderDeterministicLiveAnswer({
    question: 'Яка ціна та чи є в наявності?',
    route: { requiredResolvers: ['catalog', 'price', 'inventory'] },
    catalog: inStockCatalog,
    liveFacts: { inventory: [{ sku: 'sku-1', availability: { state: 'IN_STOCK' } }] },
    liveEvidence: { price: freshPriceEvidence, inventory: freshInventoryEvidence },
  });

  assert.equal(answer, 'За даними SalesDrive, Projector One: є в наявності. Ціна: 13 599 грн.');
});

test('deterministically renders only delivery methods without a deadline', () => {
  const answer = renderDeterministicLiveAnswer({
    question: 'Які способи доставки доступні?',
    route: { requiredResolvers: ['delivery'] },
    liveFacts: { deliveryMethods: [{ id: '1', label: 'Нова пошта' }, { id: '2', label: 'Самовивіз' }] },
    liveEvidence: { delivery: freshDeliveryEvidence },
  });

  assert.equal(answer, 'Доступні способи доставки: Нова пошта, Самовивіз. Доступність конкретного способу для замовлення підтверджується під час оформлення.');
  assert.doesNotMatch(answer, /завтра|дн\w*|годин/iu);
});

test('deterministically renders bilingual payment methods and combined dictionaries', () => {
  const paymentMethods = [
    { id: '1', label: 'Оплата карткою' },
    { id: '2', label: 'Готівка' },
    { id: '3', label: '<script>unsafe()</script>' },
  ];
  const ukrainian = renderDeterministicLiveAnswer({
    question: 'Які способи оплати доступні?',
    route: { requiredResolvers: ['payment'] },
    liveFacts: { paymentMethods },
    liveEvidence: { payment: freshPaymentEvidence },
  });
  assert.match(ukrainian, /^Доступні способи оплати:/u);
  assert.match(ukrainian, /Оплата карткою.*Готівка/u);
  assert.doesNotMatch(ukrainian, /<script>/iu);

  const combined = renderDeterministicLiveAnswer({
    question: 'Какие способы оплаты и доставки доступны?',
    route: { requiredResolvers: ['delivery', 'payment'] },
    liveFacts: {
      paymentMethods: [{ id: '1', label: 'Картой' }],
      deliveryMethods: [{ id: '2', label: 'Самовывоз' }],
    },
    liveEvidence: { payment: freshPaymentEvidence, delivery: freshDeliveryEvidence },
  });
  assert.match(combined, /Доступные способы оплаты: Картой/u);
  assert.match(combined, /Доступные способы доставки: Самовывоз/u);
  assert.doesNotMatch(combined, /одобр|гарантир|рассрочк/u);

  const productAndPayment = renderDeterministicLiveAnswer({
    question: 'Какая цена Projector One и какие способы оплаты?',
    route: { requiredResolvers: ['catalog', 'price', 'payment'] },
    catalog: inStockCatalog,
    liveFacts: { paymentMethods: [{ id: '1', label: 'Картой' }] },
    liveEvidence: { price: freshPriceEvidence, payment: freshPaymentEvidence },
  });
  assert.match(productAndPayment, /цена Projector One: 13 599 грн/u);
  assert.match(productAndPayment, /способы оплаты: Картой/u);
});

test('deterministically renders bilingual price-only questions', () => {
  assert.equal(renderDeterministicLiveAnswer({
    question: 'Какая цена Projector One?',
    route: { requiredResolvers: ['catalog', 'price'] },
    catalog: inStockCatalog,
    liveEvidence: { price: freshPriceEvidence },
  }), 'По данным SalesDrive, цена Projector One: 13 599 грн.');

  assert.equal(renderDeterministicLiveAnswer({
    question: 'Яка ціна Projector One?',
    route: { requiredResolvers: ['catalog', 'price'] },
    catalog: inStockCatalog,
    liveEvidence: { price: freshPriceEvidence },
  }), 'За даними SalesDrive, ціна Projector One: 13 599 грн.');
});

test('does not render inventory without explicit matching stock evidence', () => {
  const answer = renderDeterministicLiveAnswer({
    question: 'Есть ли в наличии?',
    route: { requiredResolvers: ['catalog', 'inventory'] },
    catalog: inStockCatalog,
    liveFacts: { inventory: [] },
    liveEvidence: { inventory: freshInventoryEvidence },
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
    liveEvidence: { inventory: freshInventoryEvidence },
  });
  assert.match(ambiguous, /Уточните.*модель или артикул/iu);
  assert.doesNotMatch(ambiguous, /Projector One|Projector Two/u);

  assert.match(renderDeterministicLiveAnswer({
    question: 'Есть ли Projector Two в наличии?',
    route: { requiredResolvers: ['catalog', 'inventory'] },
    catalog: [inStockCatalog[0], second],
    liveFacts: { inventory: facts },
    liveEvidence: { inventory: freshInventoryEvidence },
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
    liveEvidence: { inventory: freshInventoryEvidence },
  });

  assert.match(answer, /Projector One Pro/u);
});

test('keeps a delivery-deadline question on the validator path', () => {
  const answer = renderDeterministicLiveAnswer({
    question: 'Доставите завтра?',
    route: { requiredResolvers: ['delivery'] },
    liveFacts: { deliveryMethods: [{ id: '1', label: 'Нова пошта' }] },
    liveEvidence: { delivery: freshDeliveryEvidence },
  });

  assert.equal(answer, null);
});

test('never renders stale price, inventory, delivery or payment evidence', () => {
  const stale = { status: 'STALE', freshness: 'STALE', checkedAt: '2026-07-29T00:00:00Z' };
  assert.equal(renderDeterministicLiveAnswer({
    question: 'Какая цена Projector One?',
    route: { requiredResolvers: ['price'] },
    catalog: inStockCatalog,
    liveEvidence: { price: stale },
  }), null);
  assert.equal(renderDeterministicLiveAnswer({
    question: 'Есть ли Projector One в наличии?',
    route: { requiredResolvers: ['inventory'] },
    catalog: inStockCatalog,
    liveFacts: { inventory: [{ sku: 'sku-1', availability: { state: 'IN_STOCK' } }] },
    liveEvidence: { inventory: { ...stale, capabilities: ['stock'] } },
  }), null);
  assert.equal(renderDeterministicLiveAnswer({
    question: 'Какие способы доставки?',
    route: { requiredResolvers: ['delivery'] },
    liveFacts: { deliveryMethods: [{ id: '1', label: 'Нова пошта' }] },
    liveEvidence: { delivery: { ...stale, capabilities: ['methods'] } },
  }), null);
  assert.equal(renderDeterministicLiveAnswer({
    question: 'Какие способы оплаты?',
    route: { requiredResolvers: ['payment'] },
    liveFacts: { paymentMethods: [{ id: '1', label: 'Картой' }] },
    liveEvidence: { payment: { ...stale, capabilities: ['methods'] } },
  }), null);
});

test('pipeline answers payment methods deterministically from reviewed knowledge without SalesDrive or model', async () => {
  const base = {
    messages: [{ role: 'user', content: 'Какие способы оплаты доступны?' }],
    queryCatalog: async () => { throw new Error('catalog not expected'); },
    querySalesdrivePayment: async () => { throw new Error('SalesDrive payment dictionary not expected'); },
    queryKnowledge: async () => [{
      id: 'payment-methods',
      title: 'Способи оплати',
      text: 'Доступна оплата карткою та LiqPay.',
      sourceUrl: 'https://ledprojector.com.ua/oplata-1',
      reviewedAt: '2026-08-06',
    }],
    buildPrompt: ({ knowledge }) => {
      assert.equal(knowledge[0]?.id, 'payment-methods');
      return 'knowledge prompt';
    },
    askSupport: async () => { throw new Error('model not expected'); },
    askVerifier: async () => { throw new Error('verifier not expected'); },
    now: () => new Date('2026-07-29T00:01:00Z'),
  };
  const result = await executeRequestPipeline({
    ...base,
    question: 'Какие способы оплаты доступны?',
  });
  assert.equal(result.answer, 'Доступна оплата карткою та LiqPay.');
  assert.match(result.answer, /оплата карткою та LiqPay/u);
  assert.equal(result.route.intent, 'store_faq');
  assert.equal(result.freshness.live.payment.status, 'NOT_REQUIRED');
  assert.deepEqual(result.catalog, []);
  assert.equal(result.catalogDiagnostics.code, 'SKIPPED_BY_ROUTE');
  assert.deepEqual(result.verification, { status: 'SKIPPED', reason: 'DETERMINISTIC_KNOWLEDGE_POLICY' });
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

test('pipeline hides stale catalog and returns manager fallback without calling the model', async () => {
  let supportCalls = 0;
  const result = await executeRequestPipeline({
    question: 'Какая цена Projector One?',
    messages: [{ role: 'user', content: 'Какая цена Projector One?' }],
    querySalesdriveCatalog: async () => ({
      products: inStockCatalog,
      diagnostics: { code: 'STALE_LAST_KNOWN_GOOD' },
      source: 'salesdrive_yml',
      fetchedAt: '2026-07-29T00:00:00Z',
      freshness: 'STALE',
    }),
    queryCatalog: async () => { throw new Error('not expected'); },
    queryKnowledge: async () => [],
    buildPrompt: () => 'unused',
    askSupport: async () => { supportCalls += 1; return 'stale answer'; },
    askVerifier: async () => { throw new Error('not expected'); },
    now: () => new Date('2026-07-29T00:03:00Z'),
  });

  assert.equal(supportCalls, 0);
  assert.deepEqual(result.catalog, []);
  assert.equal(result.catalogDiagnostics.code, 'STALE_LAST_KNOWN_GOOD');
  assert.equal(result.catalogDiagnostics.freshness, 'STALE');
  assert.equal(result.freshness.live.price.status, 'STALE');
  assert.deepEqual(result.validation.reasons, ['LIVE_PRICE_STALE']);
  assert.match(result.answer, /^Чтобы дать точный ответ/u);
});
