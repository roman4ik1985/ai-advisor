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

test('bilingual price forms and delivery methods select only required resolvers', () => {
  for (const question of ['Какая цена?', 'Уточните цену', 'Сравните цены', 'Яка ціна?', 'Уточніть ціну']) {
    const decision = buildRouteDecision({ question });
    assert.equal(decision.intent, 'live_fact');
    assert.ok(decision.requiredResolvers.includes('price'), question);
  }

  assert.deepEqual(buildRouteDecision({ question: 'Какие способы доставки доступны?' }).requiredResolvers, ['delivery']);
  assert.deepEqual(buildRouteDecision({ question: 'Які способи доставки доступні?' }).requiredResolvers, ['delivery']);
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

test('complex pipeline verifies the draft once after deterministic validation', async () => {
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

  assert.equal(calls.support, 1);
  assert.equal(calls.verifier, 1);
  assert.equal(result.validation.action, 'ALLOW');
  assert.equal(result.verification.status, 'APPROVED');
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
