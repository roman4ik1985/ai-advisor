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
  const warnings = [];
  const diagnostics = [];
  const client = createSalesdriveApiClient({
    subdomain: 'ledprojector',
    logger: { warn: (message) => warnings.push(message) },
    diagnosticWriter: async (record) => diagnostics.push(record),
  });
  assert.deepEqual(await client.listDeliveryMethods(), {
    items: [], diagnostics: { code: 'SALES_DRIVE_API_NOT_CONFIGURED', source: 'salesdrive_api', dictionary: 'deliveryMethods' }, source: 'salesdrive_api', fetchedAt: null, freshness: 'UNAVAILABLE',
  });
  assert.deepEqual(warnings, ['[salesdrive-api] dictionary=deliveryMethods code=SALES_DRIVE_API_NOT_CONFIGURED status=NONE']);
  assert.deepEqual(diagnostics, [{
    timestamp: diagnostics[0].timestamp,
    dictionary: 'deliveryMethods',
    code: 'SALES_DRIVE_API_NOT_CONFIGURED',
    httpStatus: null,
  }]);
});

test('SalesDrive API client marks timeout and HTTP failure unavailable', async () => {
  const warnings = [];
  const diagnostics = [];
  const httpFailure = createSalesdriveApiClient({
    subdomain: 'ledprojector',
    apiKey: 'test-key',
    fetchImpl: async () => new Response('', { status: 503 }),
    logger: { warn: (message) => warnings.push(message) },
    diagnosticWriter: async (record) => diagnostics.push(record),
  });
  const httpResult = await httpFailure.listDeliveryMethods();
  assert.equal(httpResult.freshness, 'UNAVAILABLE');
  assert.deepEqual(httpResult.diagnostics, {
    code: 'SALES_DRIVE_API_HTTP_ERROR',
    source: 'salesdrive_api',
    dictionary: 'deliveryMethods',
    httpStatus: 503,
  });

  const timeout = createSalesdriveApiClient({
    subdomain: 'ledprojector',
    apiKey: 'test-key',
    timeoutMs: 1,
    logger: { warn: (message) => warnings.push(message) },
    diagnosticWriter: async (record) => diagnostics.push(record),
    fetchImpl: async (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    }),
  });
  const result = await timeout.listDeliveryMethods();
  assert.equal(result.freshness, 'UNAVAILABLE');
  assert.equal(result.diagnostics.code, 'SALES_DRIVE_API_TIMEOUT');
  assert.deepEqual(warnings, [
    '[salesdrive-api] dictionary=deliveryMethods code=SALES_DRIVE_API_HTTP_ERROR status=503',
    '[salesdrive-api] dictionary=deliveryMethods code=SALES_DRIVE_API_TIMEOUT status=NONE',
  ]);
  assert.deepEqual(diagnostics.map(({ dictionary, code, httpStatus }) => ({ dictionary, code, httpStatus })), [
    { dictionary: 'deliveryMethods', code: 'SALES_DRIVE_API_HTTP_ERROR', httpStatus: 503 },
    { dictionary: 'deliveryMethods', code: 'SALES_DRIVE_API_TIMEOUT', httpStatus: null },
  ]);
});
