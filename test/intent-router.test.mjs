import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFreshnessEvidence, buildRouteDecision, classifyIntent, getRoutePolicy, routeInstruction } from '../intent-router.mjs';
import { executeRequestPipeline } from '../request-pipeline.mjs';

test('intent router classifies the supported store request types deterministically', () => {
  assert.equal(classifyIntent({ question: 'Які способи оплати та доставки?' }), 'store_faq');
  assert.equal(classifyIntent({ question: 'Порадьте проектор для кімнати до 20 000 грн' }), 'product_advice');
  assert.equal(classifyIntent({ question: 'Есть ли Wanbo T6 Max в наличии?' }), 'live_fact');
  assert.equal(classifyIntent({ question: 'Нужен менеджер, пожалуйста перезвоните' }), 'manager_handoff');
  assert.equal(classifyIntent({ question: 'Xiaomi Wanbo T6 Max характеристики' }), 'product_lookup');
});

test('intent router limits evidence sources by route', () => {
  assert.deepEqual(getRoutePolicy('store_faq'), { catalog: false, knowledge: true });
  assert.deepEqual(getRoutePolicy('live_fact'), { catalog: true, knowledge: false });
  assert.match(routeInstruction('live_fact'), /Do not claim stock/u);
});

test('bilingual price, delivery and payment forms select only required resolvers', () => {
  for (const question of ['Какая цена?', 'Уточните цену', 'Сравните цены', 'Яка ціна?', 'Уточніть ціну']) {
    const decision = buildRouteDecision({ question });
    assert.equal(decision.intent, 'live_fact');
    assert.ok(decision.requiredResolvers.includes('price'), question);
  }

  assert.deepEqual(buildRouteDecision({ question: 'Какие способы доставки доступны?' }).requiredResolvers, ['knowledge']);
  assert.deepEqual(buildRouteDecision({ question: 'Які способи доставки доступні?' }).requiredResolvers, ['knowledge']);
  assert.deepEqual(buildRouteDecision({ question: 'Какие способы оплаты доступны?' }).requiredResolvers, ['knowledge']);
  assert.deepEqual(buildRouteDecision({ question: 'Як можна оплатити замовлення?' }).requiredResolvers, ['knowledge']);
  assert.deepEqual(buildRouteDecision({ question: 'Які способи оплати та доставки?' }).requiredResolvers, ['knowledge']);
  assert.deepEqual(buildRouteDecision({ question: 'Доступна ли рассрочка?' }).requiredResolvers, ['knowledge']);
  assert.equal(buildRouteDecision({ question: 'Нужна оценка характеристик' }).requiredResolvers.includes('price'), false);
});

test('smart router uses the full pipeline only for multi-constraint recommendations', () => {
  assert.deepEqual(buildRouteDecision({ question: 'Xiaomi Wanbo T6 Max характеристики' }), {
    route: 'SIMPLE',
    intent: 'product_lookup',
    riskLevel: 'low',
    productId: null,
    requiredResolvers: ['catalog', 'knowledge'],
    requiresVerification: false,
  });
  assert.deepEqual(buildRouteDecision({ question: 'Есть ли Wanbo T6 Max в наличии?' }), {
    route: 'STANDARD',
    intent: 'live_fact',
    riskLevel: 'medium',
    productId: null,
    requiredResolvers: ['catalog', 'inventory'],
    requiresVerification: false,
  });
  const complex = buildRouteDecision({ question: 'Порадьте проектор для PS5: чи є в наявності та коли доставка?' });
  assert.equal(complex.route, 'COMPLEX');
  assert.equal(complex.riskLevel, 'medium');
  assert.equal(complex.requiresVerification, true);
  assert.deepEqual(complex.requiredResolvers, ['catalog', 'knowledge', 'inventory', 'delivery']);
  assert.equal(buildRouteDecision({ question: 'Потрібен менеджер' }).route, 'ESCALATE');
});

test('freshness evidence keeps catalog fetch time and reviewed knowledge dates internal', () => {
  const evidence = buildFreshnessEvidence({
    intent: 'product_lookup',
    catalogDiagnostics: { code: 'OK' },
    knowledge: [{ reviewedAt: '2026-07-23' }, { reviewedAt: '2026-07-23' }, { reviewedAt: '2026-07-22' }],
    now: () => new Date('2026-07-28T10:00:00Z'),
  });

  assert.deepEqual(evidence, {
    catalog: { queried: true, fetchedAt: '2026-07-28T10:00:00.000Z', code: 'OK' },
    knowledge: { queried: true, reviewedAt: ['2026-07-23', '2026-07-22'], maxAgeDays: 180 },
    live: {},
  });
});

test('complex recommendation fails closed deterministically when product evidence is incomplete', async () => {
  const calls = { support: 0, verifier: 0 };
  const result = await executeRequestPipeline({
    question: 'Порадьте проектор для PS5: чи є в наявності та коли доставка?',
    messages: [{ role: 'user', content: 'Порадьте проектор для PS5: чи є в наявності та коли доставка?' }],
    page: {},
    querySalesdriveCatalog: async () => ({
      products: [{
        name: 'XGIMI Horizon',
        sku: 'XGIMI-HORIZON',
        url: 'https://ledprojector.com.ua/xgimi-horizon',
        prices: ['13 599 грн.'],
        availability: { state: 'IN_STOCK', stockQuantity: 2 },
      }],
      diagnostics: { code: 'OK' },
      source: 'salesdrive_yml',
      fetchedAt: '2026-07-29T00:00:00Z',
      freshness: 'FRESH',
    }),
    querySalesdriveDelivery: async () => ({
      items: [{ id: '7', label: 'Нова пошта' }],
      diagnostics: { code: 'OK' },
      source: 'salesdrive_api',
      fetchedAt: '2026-07-29T00:00:00Z',
      freshness: 'FRESH',
    }),
    queryKnowledge: async () => [{ title: 'Порада', text: 'Для PS5 варто врахувати затримку вводу.', sourceUrl: 'https://ledprojector.com.ua/', reviewedAt: '2026-07-28' }],
    buildPrompt: () => 'support prompt',
    askSupport: async () => {
      calls.support += 1;
      return 'Для PS5 важливо уточнити бажану діагональ та освітлення кімнати.';
    },
    askVerifier: async (evidence) => {
      calls.verifier += 1;
      assert.equal(evidence.route.route, 'COMPLEX');
      assert.equal(evidence.resolverResults.inventory.status, 'AVAILABLE');
      assert.equal(evidence.facts.catalog[0].name, 'XGIMI Horizon');
      return { approved: true };
    },
    now: () => new Date('2026-07-29T00:00:00Z'),
  });

  assert.equal(calls.support, 0);
  assert.equal(calls.verifier, 0);
  assert.equal(result.validation.action, 'ALLOW');
  assert.equal(result.verification.status, 'SKIPPED');
  assert.equal(result.verification.reason, 'DETERMINISTIC_PRODUCT_INSUFFICIENT_EVIDENCE');
  assert.deepEqual(result.catalog, []);
});

test('direct SalesDrive evidence enables stock but does not turn delivery methods into delivery deadlines', async () => {
  const result = await executeRequestPipeline({
    question: 'Есть ли Wanbo T6 Max в наличии и доставим завтра?',
    messages: [{ role: 'user', content: 'Есть ли Wanbo T6 Max в наличии и доставим завтра?' }],
    page: {},
    queryCatalog: async () => ({ products: [], diagnostics: { code: 'UNUSED' } }),
    querySalesdriveCatalog: async () => ({
      products: [{ name: 'Wanbo T6 Max', sku: 'T6-MAX', prices: ['13 599 грн.'], availability: { state: 'IN_STOCK', stockQuantity: 3 } }],
      diagnostics: { code: 'OK' }, source: 'salesdrive_yml', fetchedAt: '2026-07-29T00:00:00Z',
    }),
    querySalesdriveDelivery: async () => ({
      items: [{ id: '7', label: 'Нова пошта' }], diagnostics: { code: 'OK' }, source: 'salesdrive_api', fetchedAt: '2026-07-29T00:00:00Z',
    }),
    queryKnowledge: async () => [],
    buildPrompt: () => 'support prompt',
    askSupport: async () => 'Wanbo T6 Max есть в наличии, доставим завтра.',
    askVerifier: async () => ({ approved: true }),
    now: () => new Date('2026-07-29T00:01:00Z'),
  });

  assert.equal(result.freshness.live.inventory.status, 'AVAILABLE');
  assert.equal(result.freshness.live.inventory.freshness, 'FRESH');
  assert.deepEqual(result.freshness.live.delivery.capabilities, ['methods']);
  assert.equal(result.validation.accepted, false);
  assert.deepEqual(result.validation.reasons, ['UNVERIFIED_DELIVERY_DEADLINE']);
});

test('pipeline returns at most three deterministic recommendations and never calls the model or verifier', async () => {
  const calls = { support: 0, verifier: 0 };
  const products = [
    canonicalProduct({ id: 'delta', name: 'Delta Projector', price: '12 000 грн.' }),
    canonicalProduct({ id: 'alpha', name: 'Alpha Projector', price: '9 000 грн.' }),
    canonicalProduct({ id: 'charlie', name: 'Charlie Projector', price: '11 000 грн.' }),
    canonicalProduct({ id: 'bravo', name: 'Bravo Projector', price: '10 000 грн.' }),
    canonicalProduct({ id: 'over', name: 'Over Budget Projector', price: '20 000 грн.' }),
  ];
  const result = await executeRequestPipeline({
    question: 'Порадьте проектор для кімнати до 15 000 грн',
    messages: [{ role: 'user', content: 'Порадьте проектор для кімнати до 15 000 грн' }],
    page: {},
    querySalesdriveCatalog: async () => ({
      products,
      diagnostics: { code: 'OK' },
      source: 'salesdrive_yml',
      fetchedAt: '2026-07-29T00:00:00Z',
      freshness: 'FRESH',
    }),
    queryKnowledge: async () => [],
    buildPrompt: () => 'unused',
    askSupport: async () => { calls.support += 1; return 'model answer'; },
    askVerifier: async () => { calls.verifier += 1; return { approved: true }; },
    now: () => new Date('2026-07-29T00:01:00Z'),
  });

  assert.equal(calls.support, 0);
  assert.equal(calls.verifier, 0);
  assert.deepEqual(result.catalog.map((product) => product.id), ['alpha', 'bravo', 'charlie']);
  assert.equal(result.validation.accepted, true);
  assert.equal(result.verification.reason, 'DETERMINISTIC_PRODUCT_READY');
  assert.doesNotMatch(result.answer, /Over Budget/u);
});

test('pipeline clears public catalog for comparison clarification and skips the model', async () => {
  let supportCalls = 0;
  const result = await executeRequestPipeline({
    question: 'Сравните T6-MAX с другой моделью',
    messages: [{ role: 'user', content: 'Сравните T6-MAX с другой моделью' }],
    page: {},
    querySalesdriveCatalog: async () => ({
      products: [canonicalProduct({ id: 't6', name: 'Wanbo T6 Max', sku: 'T6-MAX', price: '13 599 грн.' })],
      diagnostics: { code: 'OK' },
      source: 'salesdrive_yml',
      fetchedAt: '2026-07-29T00:00:00Z',
      freshness: 'FRESH',
    }),
    queryKnowledge: async () => [],
    buildPrompt: () => 'unused',
    askSupport: async () => { supportCalls += 1; return 'model answer'; },
    askVerifier: async () => ({ approved: true }),
    now: () => new Date('2026-07-29T00:01:00Z'),
  });

  assert.equal(supportCalls, 0);
  assert.deepEqual(result.catalog, []);
  assert.equal(result.verification.reason, 'DETERMINISTIC_PRODUCT_NEEDS_CLARIFICATION');
  assert.match(result.answer, /точные названия или артикулы/u);
});

test('ordinary product lookup keeps the existing model path and complete catalog', async () => {
  let supportCatalog;
  let supportCalls = 0;
  const products = [
    canonicalProduct({ id: 't6', name: 'Xiaomi Wanbo T6 Max', sku: 'T6-MAX', price: '13 599 грн.' }),
    canonicalProduct({ id: 'cube', name: 'Wanbo Cube 2 Pro', price: '10 800 грн.' }),
  ];
  const result = await executeRequestPipeline({
    question: 'Xiaomi Wanbo T6 Max характеристики',
    messages: [{ role: 'user', content: 'Xiaomi Wanbo T6 Max характеристики' }],
    page: {},
    querySalesdriveCatalog: async () => ({
      products,
      diagnostics: { code: 'OK' },
      source: 'salesdrive_yml',
      fetchedAt: '2026-07-29T00:00:00Z',
      freshness: 'FRESH',
    }),
    queryKnowledge: async () => [],
    buildPrompt: ({ catalog }) => {
      supportCatalog = catalog;
      return 'support prompt';
    },
    askSupport: async () => { supportCalls += 1; return 'Подтверждённый ответ модели.'; },
    askVerifier: async () => ({ approved: true }),
    now: () => new Date('2026-07-29T00:01:00Z'),
  });

  assert.equal(supportCalls, 1);
  assert.strictEqual(supportCatalog, products);
  assert.strictEqual(result.catalog, products);
  assert.equal(result.answer, 'Подтверждённый ответ модели.');
  assert.equal(result.verification.reason, 'LOWER_RISK_ROUTE');
});

test('deterministic live price renderer keeps precedence over product recommendation', async () => {
  let supportCalls = 0;
  const selected = canonicalProduct({
    id: 't6',
    name: 'Xiaomi Wanbo T6 Max',
    sku: 'T6-MAX',
    price: '13 599 грн.',
  });
  const result = await executeRequestPipeline({
    question: 'Порекомендуйте: яка ціна T6-MAX?',
    messages: [{ role: 'user', content: 'Порекомендуйте: яка ціна T6-MAX?' }],
    page: {},
    querySalesdriveCatalog: async () => ({
      products: [selected],
      diagnostics: { code: 'OK' },
      source: 'salesdrive_yml',
      fetchedAt: '2026-07-29T00:00:00Z',
      freshness: 'FRESH',
    }),
    queryKnowledge: async () => [],
    buildPrompt: () => 'unused',
    askSupport: async () => { supportCalls += 1; return 'model answer'; },
    askVerifier: async () => ({ approved: true }),
    now: () => new Date('2026-07-29T00:01:00Z'),
  });

  assert.equal(supportCalls, 0);
  assert.strictEqual(result.catalog[0], selected);
  assert.equal(result.verification.reason, 'DETERMINISTIC_LIVE_FACT');
  assert.match(result.answer, /^За даними SalesDrive, ціна Xiaomi Wanbo T6 Max: 13 599 грн\./u);
});

test('broad product advice retries the cached SalesDrive catalog without changing unknown-product lookup behavior', async () => {
  const adviceQueries = [];
  const selected = canonicalProduct({
    id: 'cube',
    name: 'Wanbo Cube 2 Pro',
    price: '10 800 грн.',
  });
  const advice = await executeRequestPipeline({
    question: 'Порадьте проектор для кімнати до 15 000 грн',
    messages: [{ role: 'user', content: 'Порадьте проектор для кімнати до 15 000 грн' }],
    page: {},
    querySalesdriveCatalog: async (query) => {
      adviceQueries.push(query);
      return {
        products: query ? [] : [selected],
        diagnostics: { code: query ? 'EMPTY_RESULTS' : 'OK' },
        source: 'salesdrive_yml',
        fetchedAt: '2026-07-29T00:00:00Z',
        freshness: 'FRESH',
      };
    },
    queryKnowledge: async () => [],
    buildPrompt: () => 'unused',
    askSupport: async () => { throw new Error('model not expected'); },
    askVerifier: async () => ({ approved: true }),
    now: () => new Date('2026-07-29T00:01:00Z'),
  });

  assert.deepEqual(adviceQueries, ['Порадьте проектор для кімнати до 15 000 грн', '']);
  assert.deepEqual(advice.catalog, [selected]);
  assert.equal(advice.catalogDiagnostics.strategy, 'BROAD_PRODUCT_ADVICE');

  const lookupQueries = [];
  const lookup = await executeRequestPipeline({
    question: 'Какая цена Unknown Model ZXQ?',
    messages: [{ role: 'user', content: 'Какая цена Unknown Model ZXQ?' }],
    page: {},
    querySalesdriveCatalog: async (query) => {
      lookupQueries.push(query);
      return {
        products: [],
        diagnostics: { code: 'EMPTY_RESULTS' },
        source: 'salesdrive_yml',
        fetchedAt: '2026-07-29T00:00:00Z',
        freshness: 'FRESH',
      };
    },
    queryKnowledge: async () => [],
    buildPrompt: () => 'unused',
    askSupport: async () => { throw new Error('model not expected'); },
    askVerifier: async () => ({ approved: true }),
    now: () => new Date('2026-07-29T00:01:00Z'),
  });

  assert.deepEqual(lookupQueries, ['Какая цена Unknown Model ZXQ?']);
  assert.deepEqual(lookup.catalog, []);
  assert.deepEqual(lookup.validation.reasons, ['LIVE_PRICE_UNAVAILABLE']);
});

function canonicalProduct({
  id,
  name,
  sku = id,
  price,
  specifications = {},
}) {
  return {
    schemaVersion: '1.0',
    id,
    sku,
    name,
    aliases: [name, sku],
    canonicalUrl: `https://ledprojector.com.ua/${id}`,
    prices: price ? [price] : [],
    availability: { state: 'UNKNOWN', stockQuantity: null },
    specifications,
    images: [],
    provenance: { source: 'salesdrive_yml', sourceId: id },
    fetchedAt: '2026-07-29T00:00:00.000Z',
    freshness: 'FRESH',
  };
}
