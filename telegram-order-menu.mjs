const CALLBACK_PREFIX = 'order:';

export const TELEGRAM_ORDER_MENU = Object.freeze([
  Object.freeze({ text: '📦 Мої замовлення', callbackData: `${CALLBACK_PREFIX}list`, operation: 'LIST_ORDERS' }),
  Object.freeze({ text: '🚚 Де моє замовлення', callbackData: `${CALLBACK_PREFIX}status`, operation: 'ORDER_STATUS' }),
  Object.freeze({ text: '💳 Перевірити оплату', callbackData: `${CALLBACK_PREFIX}payment`, operation: 'PAYMENT_STATUS' }),
  Object.freeze({ text: '📍 Дані доставки', callbackData: `${CALLBACK_PREFIX}delivery`, operation: 'DELIVERY_DETAILS' }),
  Object.freeze({ text: '🔔 Налаштувати сповіщення', callbackData: `${CALLBACK_PREFIX}notifications`, operation: 'NOTIFICATION_SETTINGS' }),
]);

const OPERATIONS = new Map(TELEGRAM_ORDER_MENU.map((item) => [item.callbackData, item.operation]));

export function createTelegramOrderRateLimiter({
  now = Date.now,
  windowMs = 60_000,
  maxActions = 10,
} = {}) {
  if (
    typeof now !== 'function'
    || !Number.isSafeInteger(windowMs)
    || windowMs < 1_000
    || !Number.isSafeInteger(maxActions)
    || maxActions < 1
  ) {
    throw new TypeError('A valid clock, window, and action limit are required.');
  }
  const buckets = new Map();

  function assess(telegramUserId) {
    const userId = safeTelegramId(telegramUserId);
    const timestamp = now();
    if (!userId || !Number.isFinite(timestamp)) {
      return Object.freeze({ allowed: false, retryAfterMs: windowMs });
    }

    const active = (buckets.get(userId) ?? []).filter((item) => item > timestamp - windowMs);
    if (active.length >= maxActions) {
      buckets.set(userId, active);
      return Object.freeze({
        allowed: false,
        retryAfterMs: Math.max(1, active[0] + windowMs - timestamp),
      });
    }

    active.push(timestamp);
    buckets.set(userId, active);
    return Object.freeze({ allowed: true, retryAfterMs: 0 });
  }

  return Object.freeze({ assess });
}

export function routeTelegramOrderMenuUpdate({ update, binding } = {}) {
  const callback = update?.callback_query;
  const userId = safeTelegramId(callback?.from?.id);
  const chatId = safeTelegramId(callback?.message?.chat?.id);
  const boundUserId = safeTelegramId(binding?.telegramUserId);
  const operation = OPERATIONS.get(String(callback?.data ?? ''));

  if (
    callback?.message?.chat?.type !== 'private'
    || !operation
    || !userId
    || userId !== chatId
    || userId !== boundUserId
  ) {
    return Object.freeze({ operation: 'SHOW_MENU', requiresOrderRead: false });
  }

  return Object.freeze({
    operation,
    requiresOrderRead: ['LIST_ORDERS', 'ORDER_STATUS', 'PAYMENT_STATUS', 'DELIVERY_DETAILS']
      .includes(operation),
  });
}

export function renderTelegramOrderResponse({ operation, order, orders = [], locale = 'uk' } = {}) {
  const uk = locale !== 'ru';
  if (operation === 'LIST_ORDERS') {
    const visible = Array.isArray(orders) ? orders.slice(0, 10).filter(validOrder) : [];
    if (!visible.length) return neutralUnavailable(uk);
    return {
      code: 'ORDER_LIST',
      text: visible.map((item) => `📦 №${item.orderReference} — ${item.status.label || fallback(uk)}`).join('\n'),
    };
  }
  if (operation === 'NOTIFICATION_SETTINGS') {
    return {
      code: 'NOTIFICATION_SETTINGS',
      text: uk ? 'Оберіть події для сповіщень у меню налаштувань.' : 'Выберите события для уведомлений в меню настроек.',
    };
  }
  if (operation === 'SHOW_MENU') {
    return {
      code: 'MENU_ONLY',
      text: uk ? 'Оберіть потрібну дію кнопкою меню.' : 'Выберите нужное действие кнопкой меню.',
    };
  }
  if (!validOrder(order)) return neutralUnavailable(uk);

  if (operation === 'ORDER_STATUS') {
    return {
      code: 'ORDER_STATUS',
      text: uk
        ? `📦 Замовлення №${order.orderReference}\nСтатус: ${order.status.label || fallback(uk)}`
        : `📦 Заказ №${order.orderReference}\nСтатус: ${order.status.label || fallback(uk)}`,
    };
  }
  if (operation === 'PAYMENT_STATUS') {
    return {
      code: 'PAYMENT_STATUS',
      text: paymentText(order, uk),
    };
  }
  if (operation === 'DELIVERY_DETAILS') {
    return {
      code: 'DELIVERY_DETAILS',
      text: deliveryText(order, uk),
    };
  }
  return neutralUnavailable(uk);
}

function paymentText(order, uk) {
  const labels = uk
    ? { PAID: 'оплачено', PARTIAL: 'частково оплачено', UNPAID: 'не оплачено', UNKNOWN: 'уточнюється' }
    : { PAID: 'оплачено', PARTIAL: 'частично оплачено', UNPAID: 'не оплачено', UNKNOWN: 'уточняется' };
  const parts = [
    uk ? `💳 Замовлення №${order.orderReference}` : `💳 Заказ №${order.orderReference}`,
    `${uk ? 'Оплата' : 'Оплата'}: ${labels[order.payment.status] ?? labels.UNKNOWN}`,
  ];
  if (order.payment.total !== null) parts.push(`${uk ? 'Сума' : 'Сумма'}: ${formatMoney(order.payment.total, order.payment.currency)}`);
  if (order.payment.remaining !== null) parts.push(`${uk ? 'Залишок' : 'Остаток'}: ${formatMoney(order.payment.remaining, order.payment.currency)}`);
  return parts.join('\n');
}

function deliveryText(order, uk) {
  const parts = [uk ? `📍 Замовлення №${order.orderReference}` : `📍 Заказ №${order.orderReference}`];
  if (order.delivery.method) parts.push(`${uk ? 'Спосіб' : 'Способ'}: ${order.delivery.method}`);
  if (order.delivery.carrier) parts.push(`${uk ? 'Перевізник' : 'Перевозчик'}: ${order.delivery.carrier}`);
  if (order.delivery.city) parts.push(`${uk ? 'Місто' : 'Город'}: ${order.delivery.city}`);
  if (order.delivery.branch) parts.push(`${uk ? 'Відділення' : 'Отделение'}: ${order.delivery.branch}`);
  if (order.delivery.trackingNumber) parts.push(`ТТН: ${order.delivery.trackingNumber}`);
  if (parts.length === 1) parts.push(fallback(uk));
  return parts.join('\n');
}

function formatMoney(value, currency) {
  return `${Number(value).toFixed(2)}${currency ? ` ${currency}` : ''}`;
}

function neutralUnavailable(uk) {
  return {
    code: 'ORDER_NOT_AVAILABLE',
    text: uk
      ? 'Інформація про замовлення зараз недоступна.'
      : 'Информация о заказе сейчас недоступна.',
  };
}

function validOrder(order) {
  return order
    && order.schemaVersion === '1.0'
    && typeof order.orderReference === 'string'
    && order.status
    && order.payment
    && order.delivery;
}

function fallback(uk) {
  return uk ? 'уточнюється' : 'уточняется';
}

function safeTelegramId(value) {
  const normalized = typeof value === 'string' && /^\d+$/u.test(value) ? Number(value) : value;
  return Number.isSafeInteger(normalized) && normalized > 0 ? String(normalized) : null;
}
