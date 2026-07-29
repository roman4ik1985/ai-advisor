import test from 'node:test';
import assert from 'node:assert/strict';
import { createSalesdriveYmlClient, parseSalesdriveYml } from '../salesdrive-yml.mjs';

const yml = `<?xml version="1.0"?><yml_catalog><shop><offers>
  <offer id="wanbo-t6" available="true"><name>Wanbo T6 Max</name><vendorCode>T6-MAX</vendorCode><price>13599</price><currencyId>UAH</currencyId><stock_quantity>3</stock_quantity><url>https://store.example/wanbo-t6</url></offer>
  <offer id="sold-out" available="false"><name>Sold Out Projector</name><price>9999</price><currencyId>UAH</currencyId><stock_quantity>0</stock_quantity></offer>
</offers></shop></yml_catalog>`;

test('SalesDrive YML parser normalizes price, SKU and stock evidence', () => {
  assert.deepEqual(parseSalesdriveYml(yml), [
    {
      id: 'wanbo-t6', sku: 'T6-MAX', name: 'Wanbo T6 Max', url: 'https://store.example/wanbo-t6', image: null, category: null,
      prices: ['13 599 грн.'], oldPrice: null, availability: { state: 'IN_STOCK', stockQuantity: 3 },
    },
    {
      id: 'sold-out', sku: 'sold-out', name: 'Sold Out Projector', url: null, image: null, category: null,
      prices: ['9 999 грн.'], oldPrice: null, availability: { state: 'OUT_OF_STOCK', stockQuantity: 0 },
    },
  ]);
});

test('SalesDrive YML client caches a bounded direct response and ranks SKU matches', async () => {
  let calls = 0;
  const client = createSalesdriveYmlClient({
    ymlUrl: 'https://export.example/feed.xml',
    fetchImpl: async () => {
      calls += 1;
      return new Response(yml, { status: 200, headers: { 'content-type': 'application/xml' } });
    },
    now: () => new Date('2026-07-29T00:00:00Z'),
  });

  const first = await client.search('T6-MAX цена');
  const second = await client.search('Wanbo');
  assert.equal(calls, 1);
  assert.equal(first.diagnostics.code, 'OK');
  assert.equal(first.source, 'salesdrive_yml');
  assert.equal(first.products[0].sku, 'T6-MAX');
  assert.equal(second.products[0].name, 'Wanbo T6 Max');
});

test('SalesDrive YML client never parses DTD documents or follows an unconfigured URL', async () => {
  assert.throws(() => parseSalesdriveYml('<!DOCTYPE x [<!ENTITY y "z">]><yml_catalog/>'), /YML_UNSAFE_XML/u);
  const client = createSalesdriveYmlClient();
  assert.deepEqual(await client.search('Wanbo'), {
    products: [], diagnostics: { code: 'SALES_DRIVE_YML_NOT_CONFIGURED', source: 'salesdrive_yml' }, source: 'salesdrive_yml', fetchedAt: null,
  });
});
