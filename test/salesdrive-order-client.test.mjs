import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SALESDRIVE_ORDER_SOURCE_CONTRACT,
  createSalesdriveOrderClient,
} from '../salesdrive-order-client.mjs';

const NOW = new Date('2026-07-29T06:10:00.000Z');

function proof(overrides = {}) {
  return {
    version: '1.2',
    state: 'VERIFIED',
    purpose: 'ORDER_STATUS',
    proofSessionId: 'proof_session_0123456789abcdef',
    verifiedAt: '2026-07-29T06:05:00.000Z',
    expiresAt: '2026-07-29T06:15:00.000Z',
    consumedAt: null,
    telegramBindingVerified: true,
    orderOwnershipVerified: true,
    ...overrides,
  };
}

function binding(overrides = {}) {
  return {
    schemaVersion: '1.0',
    telegramUserId: '100200300',
    customerRef: 'salesdrive:counterparty:56',
    channel: 'TELEGRAM_REQUEST_CONTACT',
    verifiedAt: '2026-07-29T06:00:00.000Z',
    ...overrides,
  };
}

function rawOrder(overrides = {}) {
  return {
    id: 771,
    externalId: 'OC-1042',
    statusId: 5,
    paymentAmount: 2400,
    payedAmount: 2400,
    restPay: 0,
    primaryContact: {
      counterpartyId: 56,
      phone: ['0671234567'],
      email: ['client@example.test'],
    },
    products: [],
    ...overrides,
  };
}

function client(fetchImpl) {
  return createSalesdriveOrderClient({
    subdomain: 'demo-shop',
    apiKey: 'synthetic-test-key',
    fetchImpl,
    now: () => NOW,
    labels: { statuses: { 5: 'Виконано' } },
  });
}

test('C23 uses only the official GET order-list endpoint with an exact id filter', async () => {
  let request;
  const result = await client(async (url, init) => {
    request = { url: new URL(url), init };
    return { ok: true, json: async () => ({ data: [rawOrder()] }) };
  }).getOwnedOrder({ sourceOrderId: '771', binding: binding(), ownershipProof: proof() });

  assert.equal(result.ok, true);
  assert.equal(result.order.orderReference, 'OC-1042');
  assert.equal(request.url.origin, 'https://demo-shop.salesdrive.me');
  assert.equal(request.url.pathname, '/api/order/list/');
  assert.equal(request.url.searchParams.get('filter[id][from]'), '771');
  assert.equal(request.url.searchParams.get('filter[id][to]'), '771');
  assert.equal(request.url.searchParams.get('limit'), '2');
  assert.equal(request.init.method, 'GET');
  assert.equal(request.init.redirect, 'error');
  assert.equal(SALESDRIVE_ORDER_SOURCE_CONTRACT.method, 'GET');
});

test('invalid or absent proof and binding deny before any API call', async () => {
  let calls = 0;
  const orderClient = client(async () => {
    calls += 1;
    throw new Error('must not run');
  });

  for (const input of [
    { sourceOrderId: '771', binding: binding(), ownershipProof: null },
    { sourceOrderId: '771', binding: binding({ telegramUserId: '' }), ownershipProof: proof() },
    { sourceOrderId: '771', binding: binding({ customerRef: 'customer:56' }), ownershipProof: proof() },
    { sourceOrderId: 'not-an-id', binding: binding(), ownershipProof: proof() },
  ]) {
    const result = await orderClient.getOwnedOrder(input);
    assert.equal(result.code, 'ORDER_NOT_AVAILABLE');
  }
  assert.equal(calls, 0);
});

test('backend ownership check precedes DTO projection and rejects a different customer', async () => {
  const result = await client(async () => ({
    ok: true,
    json: async () => ({
      data: [rawOrder({ primaryContact: { counterpartyId: 57, phone: ['0679999999'] } })],
    }),
  })).getOwnedOrder({ sourceOrderId: '771', binding: binding(), ownershipProof: proof() });

  assert.deepEqual(result, {
    ok: false,
    code: 'ORDER_NOT_AVAILABLE',
    order: null,
    diagnosticCode: 'ORDER_NOT_AVAILABLE',
  });
  assert.equal(JSON.stringify(result).includes('0679999999'), false);
});

test('not found, duplicate results, and ownership mismatch have the same public failure', async () => {
  const payloads = [
    { data: [] },
    { data: [rawOrder(), rawOrder({ id: 772 })] },
    { data: [rawOrder({ primaryContact: { counterpartyId: 99 } })] },
  ];
  const results = [];
  for (const payload of payloads) {
    results.push(await client(async () => ({
      ok: true,
      json: async () => payload,
    })).getOwnedOrder({ sourceOrderId: '771', binding: binding(), ownershipProof: proof() }));
  }
  assert.ok(results.every((result) => result.code === 'ORDER_NOT_AVAILABLE' && result.order === null));
});

test('host is fixed and unconfigured or hostile subdomains fail closed', async () => {
  for (const subdomain of ['', 'evil.example.com/path', 'demo.salesdrive.me.evil.test']) {
    const orderClient = createSalesdriveOrderClient({
      subdomain,
      apiKey: 'key',
      fetchImpl: async () => { throw new Error('must not run'); },
      now: () => NOW,
    });
    assert.equal(orderClient.configured, false);
    const result = await orderClient.getOwnedOrder({
      sourceOrderId: '771',
      binding: binding(),
      ownershipProof: proof(),
    });
    assert.equal(result.code, 'ORDER_NOT_AVAILABLE');
  }
});

test('transport errors are neutral and never echo secrets or upstream payloads', async () => {
  const result = await client(async () => {
    throw new Error('synthetic-test-key client@example.test');
  }).getOwnedOrder({ sourceOrderId: '771', binding: binding(), ownershipProof: proof() });
  assert.equal(result.code, 'ORDER_NOT_AVAILABLE');
  assert.doesNotMatch(JSON.stringify(result), /synthetic-test-key|client@example/i);
});
