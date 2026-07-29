import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PUBLIC_ORDER_DTO_CONTRACT,
  toPublicOrderDto,
} from '../order-dto.mjs';

function rawOrder(overrides = {}) {
  return {
    id: 771,
    externalId: 'OC-1042',
    orderTime: '2026-07-28T10:00:00.000Z',
    updateAt: '2026-07-29T06:00:00.000Z',
    statusId: 5,
    payment_method: 6,
    shipping_method: 1,
    paymentAmount: 2400,
    payedAmount: 1000,
    restPay: 1400,
    currency: 'UAH',
    primaryContact: {
      id: 12,
      counterpartyId: 56,
      fName: 'Іван',
      phone: ['0671234567'],
      email: ['client@example.test'],
      telegram: 'private_handle',
      comment: 'CRM secret note',
    },
    contacts: [{ counterpartyId: 56, phone: ['0671234567'] }],
    ord_delivery_data: [{
      provider: 'novaposhta',
      cityName: 'Київ',
      branchNumber: 151,
      trackingNumber: '20450000000000',
      streetName: 'Секретна',
      house: '12',
      flat: '7',
      trackingNumberRef: 'internal-delivery-ref',
    }],
    products: [{
      productId: 1234,
      text: 'LED projector',
      sku: 'LP-01',
      amount: 1,
      price: 2400,
      costPrice: 900,
      commission: 50,
      stockId: 3,
      description: 'internal line comment',
    }],
    shipping_address: 'Київ, вул. Секретна, 12, кв. 7',
    comment: 'manager-only note',
    userId: 99,
    costPriceAmount: 900,
    commissionAmount: 50,
    expensesAmount: 100,
    profitAmount: 1350,
    utmSource: 'private-campaign',
    token: 'print-secret-token',
    ...overrides,
  };
}

const options = {
  fetchedAt: '2026-07-29T06:10:00.000Z',
  statusLabels: { 5: 'Передано в доставку' },
  paymentMethodLabels: { 6: 'Оплата карткою' },
  deliveryMethodLabels: { 1: 'Нова пошта' },
};

test('C22 projects only a bounded public order DTO', () => {
  const dto = toPublicOrderDto(rawOrder(), options);
  assert.deepEqual(dto, {
    schemaVersion: '1.0',
    orderReference: 'OC-1042',
    createdAt: '2026-07-28T10:00:00.000Z',
    updatedAt: '2026-07-29T06:00:00.000Z',
    status: { label: 'Передано в доставку' },
    payment: {
      status: 'PARTIAL',
      method: 'Оплата карткою',
      total: 2400,
      paid: 1000,
      remaining: 1400,
      currency: 'UAH',
    },
    delivery: {
      method: 'Нова пошта',
      carrier: 'novaposhta',
      city: 'Київ',
      branch: '№151',
      trackingNumber: '20450000000000',
      expectedAt: null,
    },
    items: [{ name: 'LED projector', sku: 'LP-01', quantity: 1, unitPrice: 2400 }],
    source: 'salesdrive_order_api',
    fetchedAt: '2026-07-29T06:10:00.000Z',
    freshness: 'FRESH',
  });
  assert.ok(Object.isFrozen(dto));
  assert.ok(Object.isFrozen(dto.delivery));
});

test('raw PII, exact address, internal IDs, economics, notes, and tokens never enter the DTO', () => {
  const serialized = JSON.stringify(toPublicOrderDto(rawOrder(), options));
  for (const forbidden of [
    'Іван',
    '0671234567',
    'client@example.test',
    'private_handle',
    'Секретна',
    'internal-delivery-ref',
    'manager-only note',
    'private-campaign',
    'print-secret-token',
    'costPrice',
    'profit',
    'counterpartyId',
  ]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
  assert.ok(PUBLIC_ORDER_DTO_CONTRACT.excludes.length >= 4);
});

test('missing public reference fails closed instead of exposing the SalesDrive id', () => {
  assert.equal(toPublicOrderDto(rawOrder({ externalId: null }), options), null);
});

test('items and strings are bounded and invalid numeric values become null', () => {
  const products = Array.from({ length: 30 }, (_, index) => ({
    text: `Item ${index}`,
    amount: index + 1,
    price: index === 0 ? -1 : 10,
  }));
  const dto = toPublicOrderDto(rawOrder({ products }), options);
  assert.equal(dto.items.length, 20);
  assert.equal(dto.items[0].unitPrice, null);
  assert.equal(toPublicOrderDto(rawOrder({ externalId: 'x'.repeat(65) }), options), null);
});

test('payment state is deterministic', () => {
  assert.equal(toPublicOrderDto(rawOrder({ payedAmount: 2400, restPay: 0 }), options).payment.status, 'PAID');
  assert.equal(toPublicOrderDto(rawOrder({ payedAmount: 0, restPay: 2400 }), options).payment.status, 'UNPAID');
  assert.equal(toPublicOrderDto(rawOrder({ paymentAmount: null, payedAmount: null, restPay: null }), options).payment.status, 'UNKNOWN');
});
