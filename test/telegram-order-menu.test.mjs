import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TELEGRAM_ORDER_MENU,
  createTelegramOrderRateLimiter,
  renderTelegramOrderResponse,
  routeTelegramOrderMenuUpdate,
} from '../telegram-order-menu.mjs';

const binding = {
  telegramUserId: '100200300',
  customerRef: 'salesdrive:counterparty:56',
};

function callback(data, overrides = {}) {
  return {
    callback_query: {
      data,
      from: { id: 100200300 },
      message: { chat: { id: 100200300, type: 'private' } },
      ...overrides,
    },
  };
}

const order = {
  schemaVersion: '1.0',
  orderReference: 'OC-1042',
  status: { label: 'Передано в доставку' },
  payment: { status: 'PARTIAL', total: 2400, paid: 1000, remaining: 1400, currency: 'UAH' },
  delivery: {
    method: 'Нова пошта',
    carrier: 'novaposhta',
    city: 'Київ',
    branch: '№151',
    trackingNumber: '20450000000000',
  },
};

test('C24 exposes exactly six fixed callback buttons', () => {
  assert.equal(TELEGRAM_ORDER_MENU.length, 6);
  assert.deepEqual(
    TELEGRAM_ORDER_MENU.map((item) => item.text),
    [
      '📦 Мої замовлення',
      '🚚 Де моє замовлення',
      '💳 Перевірити оплату',
      '📍 Дані доставки',
      '🔔 Налаштувати сповіщення',
      '👨‍💼 Покликати менеджера',
    ],
  );
  assert.equal(new Set(TELEGRAM_ORDER_MENU.map((item) => item.callbackData)).size, 6);
});

test('each approved callback maps directly to one deterministic operation', () => {
  for (const item of TELEGRAM_ORDER_MENU) {
    const result = routeTelegramOrderMenuUpdate({ update: callback(item.callbackData), binding });
    assert.equal(result.operation, item.operation);
  }
});

test('free text, unknown callback, groups, and a different Telegram user never trigger reads', () => {
  const updates = [
    { message: { text: 'Где заказ?', from: { id: 100200300 } } },
    callback('order:unknown'),
    callback('order:status', { message: { chat: { id: -1001, type: 'group' } } }),
    callback('order:status', { from: { id: 999 } }),
  ];
  for (const update of updates) {
    assert.deepEqual(
      routeTelegramOrderMenuUpdate({ update, binding }),
      { operation: 'SHOW_MENU', requiresOrderRead: false },
    );
  }
});

test('RU and UK templates are deterministic for status, payment, and delivery', () => {
  assert.match(renderTelegramOrderResponse({ operation: 'ORDER_STATUS', order, locale: 'uk' }).text, /Замовлення №OC-1042/);
  assert.match(renderTelegramOrderResponse({ operation: 'ORDER_STATUS', order, locale: 'ru' }).text, /Заказ №OC-1042/);
  assert.match(renderTelegramOrderResponse({ operation: 'PAYMENT_STATUS', order, locale: 'uk' }).text, /частково оплачено/);
  assert.match(renderTelegramOrderResponse({ operation: 'DELIVERY_DETAILS', order, locale: 'ru' }).text, /Отделение: №151/);
});

test('manager and notification buttons return fixed responses without order reads', () => {
  const manager = renderTelegramOrderResponse({ operation: 'REQUEST_MANAGER', locale: 'uk' });
  const notifications = renderTelegramOrderResponse({ operation: 'NOTIFICATION_SETTINGS', locale: 'ru' });
  assert.equal(manager.code, 'MANAGER_REQUEST_ACCEPTED');
  assert.equal(notifications.code, 'NOTIFICATION_SETTINGS');
});

test('missing data and unsupported operations return the same neutral unavailable response', () => {
  const results = [
    renderTelegramOrderResponse({ operation: 'ORDER_STATUS', order: null, locale: 'uk' }),
    renderTelegramOrderResponse({ operation: 'UNKNOWN', order, locale: 'uk' }),
    renderTelegramOrderResponse({ operation: 'LIST_ORDERS', orders: [], locale: 'uk' }),
  ];
  assert.ok(results.every((result) => result.code === 'ORDER_NOT_AVAILABLE'));
  assert.ok(results.every((result) => result.text === results[0].text));
});

test('C25 per-Telegram-user rate limiter fails closed and recovers after its window', () => {
  let timestamp = 1_000_000;
  const limiter = createTelegramOrderRateLimiter({
    now: () => timestamp,
    windowMs: 60_000,
    maxActions: 2,
  });
  assert.equal(limiter.assess('100200300').allowed, true);
  assert.equal(limiter.assess('100200300').allowed, true);
  const denied = limiter.assess('100200300');
  assert.equal(denied.allowed, false);
  assert.equal(denied.retryAfterMs, 60_000);
  assert.equal(limiter.assess('999').allowed, true);
  timestamp += 60_001;
  assert.equal(limiter.assess('100200300').allowed, true);
  assert.equal(limiter.assess('invalid').allowed, false);
});
