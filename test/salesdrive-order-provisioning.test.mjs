import test from 'node:test';
import assert from 'node:assert/strict';
import { createSalesdriveOrderProvisioningResolver } from '../salesdrive-order-provisioning.mjs';

test('candidate resolver uses one exact externalId GET and returns only internal proof inputs', async () => {
  let request;
  const resolver = createSalesdriveOrderProvisioningResolver({
    subdomain: 'demo-shop',
    apiKey: 'synthetic-key',
    fetchImpl: async (url, init) => {
      request = { url: new URL(url), init };
      return {
        ok: true,
        json: async () => ({
          data: [{
            id: 771,
            externalId: 'OC-1042',
            primaryContact: {
              counterpartyId: 56,
              phone: ['0671234567'],
              email: ['private@example.test'],
              fName: 'Private',
            },
          }],
        }),
      };
    },
  });
  assert.deepEqual(await resolver.resolveCandidate('OC-1042'), {
    customerRef: 'salesdrive:counterparty:56',
    expectedPhone: '+380671234567',
    sourceOrderIds: ['771'],
  });
  assert.equal(request.url.pathname, '/api/order/list/');
  assert.equal(request.url.searchParams.get('filter[externalId]'), 'OC-1042');
  assert.equal(request.url.searchParams.get('limit'), '2');
  assert.equal(request.init.method, 'GET');
  assert.equal(JSON.stringify(await resolver.resolveCandidate('missing')), 'null');
});

test('duplicate, malformed, phone-less, and transport results fail closed', async () => {
  const payloads = [
    { data: [] },
    { data: [{ id: 1, externalId: 'X' }, { id: 2, externalId: 'X' }] },
    { data: [{ id: 1, externalId: 'X', primaryContact: { counterpartyId: 2, phone: [] } }] },
  ];
  for (const payload of payloads) {
    const resolver = createSalesdriveOrderProvisioningResolver({
      subdomain: 'demo',
      apiKey: 'key',
      fetchImpl: async () => ({ ok: true, json: async () => payload }),
    });
    assert.equal(await resolver.resolveCandidate('X'), null);
  }
});
