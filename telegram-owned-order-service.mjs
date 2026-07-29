export function createTelegramOwnedOrderService({
  stateStore,
  orderClient,
} = {}) {
  if (
    typeof stateStore?.getOwnedSourceOrderIds !== 'function'
    || typeof stateStore?.issueLookupGrant !== 'function'
    || typeof stateStore?.consumeLookupGrant !== 'function'
    || typeof orderClient?.getOwnedOrder !== 'function'
  ) {
    throw new TypeError('Owned-order state and exact-ID client are required.');
  }

  async function listOwnedOrders({ binding, limit = 10 } = {}) {
    const userId = String(binding?.telegramUserId ?? '');
    const ids = (await stateStore.getOwnedSourceOrderIds(userId)).slice(0, Math.min(10, limit));
    const orders = [];
    for (const sourceOrderId of ids) {
      const selection = {
        telegramUserId: userId,
        customerRef: binding.customerRef,
        sourceOrderId,
      };
      const proofSessionId = await stateStore.issueLookupGrant({ telegramUserId: userId, selection });
      const grant = proofSessionId
        ? await stateStore.consumeLookupGrant({ telegramUserId: userId, proofSessionId })
        : null;
      if (!grant) continue;
      const result = await orderClient.getOwnedOrder({
        sourceOrderId,
        binding,
        ownershipProof: grant.proof,
      });
      if (result?.ok && result.order) orders.push({ sourceOrderId, order: result.order });
    }
    return Object.freeze({ orders: Object.freeze(orders) });
  }

  return Object.freeze({
    listOwnedOrders,
    getOwnedOrder: (input) => orderClient.getOwnedOrder(input),
  });
}
