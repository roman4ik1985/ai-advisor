export function createTelegramOrderActionSink({
  sender,
  stateStore,
} = {}) {
  if (
    typeof sender?.dispatch !== 'function'
    || typeof stateStore?.toggleNotifications !== 'function'
  ) {
    throw new TypeError('Telegram sender and state store are required.');
  }

  async function dispatch(action) {
    if (action?.type === 'OPEN_NOTIFICATION_SETTINGS') return toggleNotifications(action);
    return false;
  }

  async function toggleNotifications(action) {
    const userId = normalizeUser(action.telegramUserId);
    const customerRef = normalizeCustomerRef(action.customerRef);
    if (!userId || !customerRef) return false;
    const enabled = await stateStore.toggleNotifications({
      telegramUserId: userId,
      customerRef,
    });
    if (typeof enabled !== 'boolean') return false;
    return sender.dispatch({
      type: 'SEND_MESSAGE',
      chatId: userId,
      text: enabled
        ? 'Сповіщення про зміни замовлення увімкнено.'
        : 'Сповіщення про зміни замовлення вимкнено.',
    });
  }

  return Object.freeze({ dispatch });
}

function normalizeUser(value) {
  const TELEGRAM_ID = /^[1-9]\d{0,19}$/u;
  const normalized = String(value ?? '');
  return TELEGRAM_ID.test(normalized) ? normalized : null;
}

function normalizeCustomerRef(value) {
  const normalized = String(value ?? '');
  return /^[A-Za-z0-9:_-]{1,128}$/u.test(normalized) ? normalized : null;
}
