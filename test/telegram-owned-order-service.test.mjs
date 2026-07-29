import test from 'node:test';
import assert from 'node:assert/strict';
import { createTelegramOwnedOrderService } from '../telegram-owned-order-service.mjs';

const binding = {
  telegramUserId: '100200300',
  customerRef: 'salesdrive:counterparty:56',
};

test('owned-order service lists only IDs already stored by verified link state', async () => {
  const lookedUp = [];
  const service = createTelegramOwnedOrderService({
    stateStore: {
      getOwnedSourceOrderIds: async () => ['771', '772'],
      issueLookupGrant: async ({ selection }) => `proof-${selection.sourceOrderId}`,
      consumeLookupGrant: async ({ proofSessionId }) => ({
        sourceOrderId: proofSessionId.slice(6),
        proof: { orderOwnershipVerified: true },
      }),
    },
    orderClient: {
      async getOwnedOrder(input) {
        lookedUp.push(input.sourceOrderId);
        return input.sourceOrderId === '771'
          ? { ok: true, order: { schemaVersion: '1.0', orderReference: 'OC-1042' } }
          : { ok: false };
      },
    },
  });
  const result = await service.listOwnedOrders({ binding });
  assert.deepEqual(lookedUp, ['771', '772']);
  assert.deepEqual(result.orders, [{
    sourceOrderId: '771',
    order: { schemaVersion: '1.0', orderReference: 'OC-1042' },
  }]);
});

test('missing one-time grant prevents exact-ID lookup', async () => {
  let calls = 0;
  const service = createTelegramOwnedOrderService({
    stateStore: {
      getOwnedSourceOrderIds: async () => ['771'],
      issueLookupGrant: async () => null,
      consumeLookupGrant: async () => null,
    },
    orderClient: {
      async getOwnedOrder() { calls += 1; },
    },
  });
  assert.deepEqual(await service.listOwnedOrders({ binding }), { orders: [] });
  assert.equal(calls, 0);
});
