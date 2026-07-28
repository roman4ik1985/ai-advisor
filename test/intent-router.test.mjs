import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFreshnessEvidence, classifyIntent, getRoutePolicy, routeInstruction } from '../intent-router.mjs';

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
  });
});
