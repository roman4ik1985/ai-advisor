import assert from 'node:assert/strict';
import test from 'node:test';
import { buildProductRecommendation } from '../product-recommender.mjs';

function product({
  id,
  name,
  sku = id,
  aliases = [],
  prices = [],
  specifications = {},
  freshness = 'FRESH',
  provenance = { source: 'salesdrive_yml', sourceId: id },
} = {}) {
  return {
    schemaVersion: '1.0',
    id,
    sku,
    name,
    aliases: [name, sku, ...aliases],
    canonicalUrl: `https://ledprojector.com.ua/${id}`,
    prices,
    oldPrice: null,
    availability: { state: 'UNKNOWN', stockQuantity: null },
    specifications,
    images: [],
    provenance,
    fetchedAt: '2026-07-29T00:00:00.000Z',
    freshness,
  };
}

const cube = product({
  id: 'cube-2-pro',
  name: 'Wanbo Cube 2 Pro',
  sku: 'CUBE-2-PRO',
  aliases: ['Xiaomi Wanbo Cube 2 Pro'],
  prices: ['10 800 грн.'],
  specifications: {
    'Яскравість, (ANSI Lm)': '500',
    'Рідне розширення': 'Full HD (1920x1080)',
    'Бездротові модулі': 'Wi-Fi 6, Bluetooth',
  },
});
const t6 = product({
  id: 't6-max',
  name: 'Xiaomi Wanbo T6 Max',
  sku: 'T6-MAX',
  prices: ['13 599 грн.'],
  specifications: {
    'Яскравість, (ANSI Lm)': '650',
    'Рідне розширення': 'Full HD (1920x1080)',
    'Бездротові модулі': 'Wi-Fi 5, Bluetooth 5.0',
  },
});
const xgimi = product({
  id: 'xgimi-mogo',
  name: 'XGIMI MoGo',
  sku: 'MOGO',
  prices: ['18 999 грн.'],
  specifications: {
    'Яскравість, (ANSI Lm)': '300',
    'Рідне розширення': '960x540',
  },
});

test('recommends at most three original canonical products under a RU budget', () => {
  const extra = product({ id: 'alpha', name: 'Alpha Projector', prices: ['9 000 грн.'] });
  const result = buildProductRecommendation({
    question: 'Порекомендуйте проектор до 15 000 грн',
    products: [t6, cube, xgimi, extra],
  });

  assert.equal(result.mode, 'RECOMMEND');
  assert.equal(result.language, 'ru');
  assert.equal(result.status, 'READY');
  assert.equal(result.products.length, 3);
  assert.ok(result.products.includes(t6));
  assert.ok(result.products.includes(cube));
  assert.ok(result.products.includes(extra));
  assert.ok(result.products.every((item) => item !== xgimi));
  assert.strictEqual(result.products.find((item) => item.id === t6.id), t6);
  assert.ok(result.reasons.includes('BUDGET_APPLIED_TO_CONFIRMED_PRICE'));
});

test('applies a Ukrainian budget only to confirmed parseable prices', () => {
  const unknownPrice = product({ id: 'unknown', name: 'Unknown Price', prices: [] });
  const result = buildProductRecommendation({
    question: 'Порадьте проектор бюджетом до 11 000 грн',
    products: [cube, t6, unknownPrice],
  });

  assert.deepEqual(result.products, [cube]);
  assert.match(result.answer, /^Варіанти за підтвердженими даними:/u);
  assert.doesNotMatch(result.answer, /Unknown Price|Xiaomi Wanbo T6 Max/u);
});

test('requires every explicitly requested specification for recommendations', () => {
  const withoutWirelessEvidence = product({
    id: 'no-wireless',
    name: 'No Wireless Evidence',
    prices: ['8 000 грн.'],
    specifications: { 'Рідне розширення': 'Full HD (1920x1080)' },
  });
  const result = buildProductRecommendation({
    question: 'Порадьте проектор з Wi-Fi до 15 000 грн',
    products: [withoutWirelessEvidence, cube],
  });

  assert.deepEqual(result.products, [cube]);
  assert.match(result.answer, /Wi-Fi — Wi-Fi 6, Bluetooth/u);
});

test('compares only products identified by exact aliases or SKU', () => {
  const result = buildProductRecommendation({
    question: 'Сравните CUBE-2-PRO и T6-MAX по яркости',
    products: [xgimi, t6, cube],
  });

  assert.equal(result.mode, 'COMPARE');
  assert.equal(result.status, 'READY');
  assert.deepEqual(result.products, [cube, t6]);
  assert.match(result.answer, /Wanbo Cube 2 Pro: цена — 10 800 грн\.; яркость — 500/u);
  assert.match(result.answer, /Xiaomi Wanbo T6 Max: цена — 13 599 грн\.; яркость — 650/u);
  assert.doesNotMatch(result.answer, /XGIMI MoGo/u);
  assert.match(result.answer, /Победителя не определяю/u);
});

test('renders missing comparison facts as unconfirmed and never invents a winner', () => {
  const result = buildProductRecommendation({
    question: 'Порівняйте Wanbo Cube 2 Pro і XGIMI MoGo за Wi-Fi',
    products: [cube, xgimi],
  });

  assert.equal(result.status, 'READY');
  assert.match(result.answer, /Wanbo Cube 2 Pro:.*Wi-Fi — Wi-Fi 6, Bluetooth/u);
  assert.match(result.answer, /XGIMI MoGo:.*Wi-Fi — не підтверджено/u);
  assert.match(result.answer, /Переможця не визначаю/u);
  assert.doesNotMatch(result.answer, /кращ|лучше/iu);
});

test('asks for exact identities when fewer than two comparison products match', () => {
  const result = buildProductRecommendation({
    question: 'Сравните T6-MAX с другой моделью',
    products: [cube, t6, xgimi],
  });

  assert.equal(result.status, 'NEEDS_CLARIFICATION');
  assert.deepEqual(result.products, []);
  assert.deepEqual(result.reasons, ['TWO_EXACT_PRODUCTS_REQUIRED']);
  assert.match(result.answer, /точные названия или артикулы/u);
});

test('rejects stale products and products without provenance', () => {
  const stale = product({ id: 'stale', name: 'Stale Product', prices: ['7 000 грн.'], freshness: 'STALE' });
  const noProvenance = product({
    id: 'no-source',
    name: 'No Source Product',
    prices: ['6 000 грн.'],
    provenance: null,
  });
  const result = buildProductRecommendation({
    question: 'Порадьте проектор до 10 000 грн',
    products: [stale, noProvenance],
  });

  assert.equal(result.status, 'INSUFFICIENT_EVIDENCE');
  assert.deepEqual(result.products, []);
  assert.deepEqual(result.reasons, ['NO_FRESH_PROVENANCED_PRODUCTS']);
  assert.match(result.answer, /Недостатньо свіжих підтверджених даних/u);
});

test('rejects a nominally fresh product without a valid evidence timestamp', () => {
  const missingTimestamp = { ...cube, fetchedAt: null };
  const result = buildProductRecommendation({
    question: 'Порадьте проектор до 15 000 грн',
    products: [missingTimestamp],
  });

  assert.equal(result.status, 'INSUFFICIENT_EVIDENCE');
  assert.deepEqual(result.products, []);
  assert.deepEqual(result.reasons, ['NO_FRESH_PROVENANCED_PRODUCTS']);
});

test('uses stable score then product identity order and honors a smaller limit', () => {
  const first = product({ id: 'a', name: 'Alpha', prices: ['5 000 грн.'] });
  const second = product({ id: 'b', name: 'Beta', prices: ['6 000 грн.'] });
  const result = buildProductRecommendation({
    question: 'Посоветуйте проектор',
    products: [second, first, cube],
    maxResults: 2,
  });

  assert.deepEqual(result.products, [first, second]);
});

test('recognizes current product-advice phrases without requiring an imperative verb', () => {
  for (const question of [
    'Проектор для дома',
    'Проектор для комнаты',
    'Проектор для кімнати',
    'Бюджет 15 000 грн',
    'Нужна высокая яркость',
    'Потрібна висока яскравість',
  ]) {
    const result = buildProductRecommendation({ question, products: [cube] });
    assert.equal(result.mode, 'RECOMMEND', question);
  }
});
