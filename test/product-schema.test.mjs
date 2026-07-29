import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProductAliases, safeStoreUrl, toPublicProduct } from '../product-schema.mjs';

test('public product DTO is bounded, deterministic and retains compatible public fields', () => {
  const product = toPublicProduct({
    id: 'sd-42',
    sku: 'T6-MAX',
    name: 'Wanbo T6 Max',
    aliases: ['T6 Max', 'wanbo t6 max', 'T6 Max'],
    url: 'https://ledprojector.com.ua/projectors/t6#details',
    image: 'https://ledprojector.com.ua/image/t6.jpg',
    images: ['https://evil.example/tracker.gif'],
    prices: ['13 599 грн.'],
    availability: { state: 'IN_STOCK', stockQuantity: 3 },
    specifications: { Resolution: 'Full HD', Brightness: '650 ANSI' },
    customerPhone: '+380000000000',
  }, {
    fetchedAt: '2026-07-29T00:00:00Z',
    freshness: 'FRESH',
  });

  assert.equal(product.id, 'sd-42');
  assert.equal(product.url, 'https://ledprojector.com.ua/projectors/t6');
  assert.equal(product.image, 'https://ledprojector.com.ua/image/t6.jpg');
  assert.deepEqual(product.images, ['https://ledprojector.com.ua/image/t6.jpg']);
  assert.deepEqual(product.aliases, ['Wanbo T6 Max', 'T6 Max', 'T6-MAX', 'sd-42', 'wanbot6max', 't6max']);
  assert.deepEqual(product.provenance, { source: 'salesdrive_yml', sourceId: 'sd-42' });
  assert.equal(product.fetchedAt, '2026-07-29T00:00:00.000Z');
  assert.equal(product.freshness, 'FRESH');
  assert.equal('customerPhone' in product, false);
});

test('aliases are deterministic, deduplicated and bounded', () => {
  const aliases = buildProductAliases({
    id: 'product-id',
    sku: 'SKU-1',
    name: 'Projector One',
    aliases: Array.from({ length: 30 }, (_, index) => `Alias ${index}`),
  });
  assert.equal(aliases.length, 12);
  assert.deepEqual(aliases.slice(0, 3), ['Projector One', 'Alias 0', 'Alias 1']);
  assert.deepEqual(aliases, buildProductAliases({
    id: 'product-id',
    sku: 'SKU-1',
    name: 'Projector One',
    aliases: Array.from({ length: 30 }, (_, index) => `Alias ${index}`),
  }));
});

test('unsafe and external URLs are rejected fail closed', () => {
  assert.equal(safeStoreUrl('javascript:alert(1)'), null);
  assert.equal(safeStoreUrl('https://user:secret@ledprojector.com.ua/item'), null);
  assert.equal(safeStoreUrl('https://evil.example/item'), null);
  assert.equal(safeStoreUrl('http://ledprojector.com.ua/item'), null);
  assert.equal(safeStoreUrl('https://ledprojector.com.ua/item#buy'), 'https://ledprojector.com.ua/item');
});

test('product without stable SalesDrive identity or public name is rejected', () => {
  assert.equal(toPublicProduct({ name: 'Mutable name only' }), null);
  assert.equal(toPublicProduct({ id: '42' }), null);
  assert.deepEqual(
    toPublicProduct({ id: '42', name: 'Product', availability: { state: 'UNKNOWN', stockQuantity: null } }).availability,
    { state: 'UNKNOWN', stockQuantity: null },
  );
});
