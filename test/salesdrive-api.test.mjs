import test from 'node:test';
import assert from 'node:assert/strict';
import { createSalesdriveApiClient } from '../salesdrive-api.mjs';

test('SalesDrive API client allows only configured GET dictionary calls and projects safe fields', async () => {
  const calls = [];
  const client = createSalesdriveApiClient({
    subdomain: 'ledprojector',
    apiKey: 'test-key',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return new Response(JSON.stringify({ data: [{ id: 7, name: 'Нова пошта', internal: 'omit' }] }), { status: 200 });
    },
    now: () => new Date('2026-07-29T00:00:00Z'),
  });

  const result = await client.listDeliveryMethods();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://ledprojector.salesdrive.me/api/delivery-methods/');
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(calls[0].options.headers['X-Api-Key'], 'test-key');
  assert.deepEqual(result.items, [{ id: '7', label: 'Нова пошта' }]);
  assert.equal(result.diagnostics.code, 'OK');
  assert.equal(result.freshness, 'FRESH');
});

test('SalesDrive API client fails closed without credentials', async () => {
  const client = createSalesdriveApiClient({ subdomain: 'ledprojector' });
  assert.deepEqual(await client.listDeliveryMethods(), {
    items: [], diagnostics: { code: 'SALES_DRIVE_API_NOT_CONFIGURED', source: 'salesdrive_api' }, source: 'salesdrive_api', fetchedAt: null, freshness: 'UNAVAILABLE',
  });
});

test('SalesDrive API client marks timeout and HTTP failure unavailable', async () => {
  const httpFailure = createSalesdriveApiClient({
    subdomain: 'ledprojector',
    apiKey: 'test-key',
    fetchImpl: async () => new Response('', { status: 503 }),
  });
  assert.equal((await httpFailure.listDeliveryMethods()).freshness, 'UNAVAILABLE');

  const timeout = createSalesdriveApiClient({
    subdomain: 'ledprojector',
    apiKey: 'test-key',
    timeoutMs: 1,
    fetchImpl: async (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    }),
  });
  const result = await timeout.listDeliveryMethods();
  assert.equal(result.freshness, 'UNAVAILABLE');
  assert.equal(result.diagnostics.code, 'SALES_DRIVE_API_TIMEOUT');
});
