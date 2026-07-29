const DTO_VERSION = '1.0';
const MAX_ITEMS = 20;

export const PUBLIC_ORDER_DTO_CONTRACT = Object.freeze({
  version: DTO_VERSION,
  maxItems: MAX_ITEMS,
  excludes: Object.freeze([
    'customer names, phones, email, Telegram handles, and exact address',
    'CRM comments, manager fields, marketing attribution, and print tokens',
    'internal order, contact, counterparty, product, warehouse, and delivery refs',
    'cost price, commission, expenses, profit, and payment credentials',
  ]),
});

export function toPublicOrderDto(rawOrder, {
  fetchedAt = new Date().toISOString(),
  statusLabels = {},
  paymentMethodLabels = {},
  deliveryMethodLabels = {},
} = {}) {
  if (!isPlainObject(rawOrder)) return null;

  const orderReference = boundedText(rawOrder.externalId ?? rawOrder.orderReference, 64);
  if (!orderReference) return null;

  const total = money(rawOrder.paymentAmount);
  const paid = money(rawOrder.payedAmount);
  const remaining = money(rawOrder.restPay);
  const delivery = Array.isArray(rawOrder.ord_delivery_data)
    ? rawOrder.ord_delivery_data.find(isPlainObject)
    : null;

  return deepFreeze({
    schemaVersion: DTO_VERSION,
    orderReference,
    createdAt: safeDate(rawOrder.orderTime),
    updatedAt: safeDate(rawOrder.updateAt),
    status: {
      label: lookupLabel(statusLabels, rawOrder.statusId)
        ?? boundedText(rawOrder.statusLabel, 80),
    },
    payment: {
      status: paymentState({ total, paid, remaining }),
      method: lookupLabel(paymentMethodLabels, rawOrder.payment_method)
        ?? boundedText(rawOrder.paymentMethodLabel, 80),
      total,
      paid,
      remaining,
      currency: currency(rawOrder.currency),
    },
    delivery: {
      method: lookupLabel(deliveryMethodLabels, rawOrder.shipping_method)
        ?? boundedText(rawOrder.deliveryMethodLabel, 80),
      carrier: boundedText(delivery?.provider, 40),
      city: boundedText(delivery?.cityName, 80),
      branch: branchLabel(delivery?.branchNumber),
      trackingNumber: boundedText(delivery?.trackingNumber, 64),
      expectedAt: safeDate(delivery?.deliveryDateAndTime),
    },
    items: normalizeItems(rawOrder.products),
    source: 'salesdrive_order_api',
    fetchedAt: safeDate(fetchedAt),
    freshness: 'FRESH',
  });
}

function normalizeItems(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_ITEMS).map((item) => {
    if (!isPlainObject(item)) return null;
    const name = boundedText(item.text ?? item.documentName, 160);
    const quantity = nonNegativeNumber(item.amount);
    if (!name || quantity === null) return null;
    return {
      name,
      sku: boundedText(item.sku, 64),
      quantity,
      unitPrice: money(item.price),
    };
  }).filter(Boolean);
}

function paymentState({ total, paid, remaining }) {
  if (remaining !== null && remaining <= 0 && (paid ?? total ?? 0) > 0) return 'PAID';
  if ((paid ?? 0) > 0) return 'PARTIAL';
  if ((total ?? remaining ?? 0) > 0) return 'UNPAID';
  return 'UNKNOWN';
}

function lookupLabel(labels, key) {
  if (!isPlainObject(labels) || key == null) return null;
  return boundedText(labels[String(key)], 80);
}

function branchLabel(value) {
  const normalized = boundedText(value, 20);
  return normalized ? `№${normalized.replace(/^№/u, '')}` : null;
}

function currency(value) {
  const normalized = String(value ?? '').trim().toUpperCase();
  return /^[A-Z]{3}$/u.test(normalized) ? normalized : null;
}

function money(value) {
  const normalized = nonNegativeNumber(value);
  return normalized === null ? null : Math.round(normalized * 100) / 100;
}

function nonNegativeNumber(value) {
  if (value === '' || value == null) return null;
  const normalized = Number(value);
  return Number.isFinite(normalized) && normalized >= 0 ? normalized : null;
}

function safeDate(value) {
  if (value == null || value === '') return null;
  const normalized = String(value).trim().replace(' ', 'T');
  const milliseconds = Date.parse(normalized);
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : null;
}

function boundedText(value, maxLength) {
  const normalized = String(value ?? '').trim();
  return normalized && normalized.length <= maxLength ? normalized : null;
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function deepFreeze(value) {
  Object.freeze(value);
  for (const child of Object.values(value)) {
    if (child && typeof child === 'object' && !Object.isFrozen(child)) deepFreeze(child);
  }
  return value;
}
