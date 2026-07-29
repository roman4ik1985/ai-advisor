import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildProductSpecificationEvidence,
  enrichProductsWithSpecificationEvidence,
  mergeProductSpecificationEvidence,
} from '../product-specification-evidence.mjs';
import { resolveLiveEvidence } from '../live-resolvers.mjs';

const rawProduct = {
  sku: 'DEMO-1',
  name: 'Demo Projector',
  canonicalUrl: 'https://ledprojector.com.ua/proektory/demo-1',
  sourceUrl: 'https://ledprojector.com.ua/proektory/demo-1',
  capturedAt: '2026-07-29T09:00:00Z',
  sourceHash: 'a'.repeat(64),
  specifications: {
    Resolution: 'Full HD',
    Brightness: '1500 ISO',
    Price: '13999 UAH',
    Наявність: 'Є',
    Доставка: 'завтра',
  },
};

test('C33 promotes only reviewed non-commercial specifications with provenance', () => {
  const evidence = buildProductSpecificationEvidence(rawProduct, {
    reviewedAt: '2026-07-29',
    reviewer: 'operator',
  });
  assert.deepEqual(evidence.specifications, {
    Brightness: '1500 ISO',
    Resolution: 'Full HD',
  });
  assert.equal(evidence.provenance.source, 'official_public_product_page');
  assert.equal('price' in evidence, false);
  assert.equal('availability' in evidence, false);
});

test('product enrichment fills missing specifications but preserves live values', () => {
  const evidence = buildProductSpecificationEvidence(rawProduct, {
    reviewedAt: '2026-07-29',
    reviewer: 'operator',
  });
  const [product] = enrichProductsWithSpecificationEvidence([{
    sku: 'DEMO-1',
    canonicalUrl: rawProduct.canonicalUrl,
    specifications: { Resolution: '4K confirmed by live feed' },
    prices: ['13999'],
    availability: { state: 'IN_STOCK' },
  }], [evidence]);
  assert.equal(product.specifications.Brightness, '1500 ISO');
  assert.equal(product.specifications.Resolution, '4K confirmed by live feed');
  assert.deepEqual(product.prices, ['13999']);
  assert.deepEqual(product.availability, { state: 'IN_STOCK' });
  assert.equal(product.specificationEvidence.reviewedAt, '2026-07-29');
});

test('merge rejects hostile sources and replaces the same reviewed identity', () => {
  const accepted = buildProductSpecificationEvidence(rawProduct, {
    reviewedAt: '2026-07-29',
    reviewer: 'operator',
  });
  const hostile = buildProductSpecificationEvidence({
    ...rawProduct,
    sourceUrl: 'https://example.com/proektory/demo-1',
  }, {
    reviewedAt: '2026-07-29',
    reviewer: 'operator',
  });
  assert.equal(hostile, null);
  assert.equal(mergeProductSpecificationEvidence([accepted], [accepted]).length, 1);
});

test('live resolver enriches only a fresh catalog and keeps live price and stock', async () => {
  const evidence = buildProductSpecificationEvidence(rawProduct, {
    reviewedAt: '2026-07-29',
    reviewer: 'operator',
  });
  const liveProduct = {
    sku: 'DEMO-1',
    canonicalUrl: rawProduct.canonicalUrl,
    specifications: {},
    prices: ['13999'],
    availability: { state: 'IN_STOCK', stockQuantity: 2 },
  };
  const result = await resolveLiveEvidence({
    route: { requiredResolvers: ['catalog', 'price', 'inventory'] },
    querySalesdriveCatalog: async () => ({
      products: [liveProduct],
      freshness: 'FRESH',
      diagnostics: { code: 'OK' },
      source: 'salesdrive_yml',
      fetchedAt: '2026-07-29T09:00:00Z',
    }),
    productSpecificationEvidence: [evidence],
    now: () => new Date('2026-07-29T09:01:00Z'),
  });
  assert.equal(result.catalog[0].specifications.Resolution, 'Full HD');
  assert.deepEqual(result.catalog[0].prices, ['13999']);
  assert.deepEqual(result.catalog[0].availability, { state: 'IN_STOCK', stockQuantity: 2 });
  assert.equal(result.evidence.price.status, 'AVAILABLE');
  assert.equal(result.evidence.inventory.status, 'AVAILABLE');
});
