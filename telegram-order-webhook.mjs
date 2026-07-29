import { createHash, timingSafeEqual } from 'node:crypto';
import { verifyTelegramContactBinding } from './telegram-order-binding.mjs';
import {
  TELEGRAM_ORDER_MENU,
  renderTelegramOrderResponse,
  routeTelegramOrderMenuUpdate,
} from './telegram-order-menu.mjs';

const START_TOKEN = /^[A-Za-z0-9_-]{32}$/u;
const CHOICE_CALLBACK = /^order:select:([A-Za-z0-9_-]{32})$/u;
const TELEGRAM_ID = /^[1-9]\d{0,19}$/u;

export const TELEGRAM_ORDER_WEBHOOK_CONTRACT = Object.freeze({
  transport: 'Telegram private webhook',
  requiresSecretHeader: 'X-Telegram-Bot-Api-Secret-Token',
  accepts: Object.freeze(['/start <opaque-token>', 'own request_contact', 'allow-listed callback_query']),
  freeText: false,
  ai: false,
});

export function createTelegramOrderWebhook({
  secretToken,
  stateStore,
  rateLimiter,
  orderService,
  now = Date.now,
} = {}) {
  const normalizedSecret = String(secretToken ?? '');
  if (
    !/^[A-Za-z0-9_-]{16,256}$/u.test(normalizedSecret)
    || !stateStore
    || typeof rateLimiter?.assess !== 'function'
    || typeof orderService?.listOwnedOrders !== 'function'
    || typeof orderService?.getOwnedOrder !== 'function'
    || typeof now !== 'function'
  ) {
    throw new TypeError('Webhook secret and all source adapters are required.');
  }

  async function handle({ secretHeader, update } = {}) {
    if (!safeSecretEquals(normalizedSecret, secretHeader)) return result(401, 'WEBHOOK_UNAUTHORIZED');
    if (!isPlainObject(update) || !Number.isSafeInteger(update.update_id)) {
      return result(400, 'WEBHOOK_INVALID_UPDATE');
    }
    if (!await stateStore.claimUpdate(update.update_id)) return result(200, 'WEBHOOK_DUPLICATE');

    const message = update.message;
    const callback = update.callback_query;
    if (message) return handleMessage(message, update);
    if (callback) return handleCallback(callback, update);
    return result(200, 'WEBHOOK_IGNORED');
  }

  async function handleMessage(message, update) {
    const userId = privateUserId(message);
    if (!userId) return result(200, 'PRIVATE_CHAT_REQUIRED');
    const rate = await rateLimiter.assess(userId);
    if (!rate.allowed) {
      return result(200, 'RATE_LIMITED', [
        sendMessage(userId, 'Забагато дій. Спробуйте трохи пізніше.'),
      ]);
    }

    const startToken = parseStartToken(message.text);
    if (startToken) {
      const link = await stateStore.beginLink({ telegramUserId: userId, token: startToken });
      if (!link) return neutralMessage(userId);
      return result(200, 'CONTACT_REQUIRED', [
        sendMessage(userId, 'Поділіться своїм номером кнопкою нижче.', {
          keyboard: [[{ text: 'Поділитися номером', requestContact: true }]],
          resizeKeyboard: true,
          oneTimeKeyboard: true,
        }),
      ]);
    }

    if (message.contact) {
      const pending = await stateStore.getPendingLink(userId);
      if (!pending) return neutralMessage(userId);
      const decision = verifyTelegramContactBinding({
        linkSession: pending.linkSession,
        startToken: pending.token,
        update,
        expectedPhone: pending.expectedPhone,
        customerRef: pending.customerRef,
        now: now(),
      });
      if (!decision.canBind || !decision.consumeLinkSession) return neutralMessage(userId);
      const completed = await stateStore.completeBinding({
        telegramUserId: userId,
        token: pending.token,
        binding: decision.binding,
      });
      return completed
        ? menuMessage(userId, 'TELEGRAM_CUSTOMER_LINKED')
        : neutralMessage(userId);
    }

    return await stateStore.getBinding(userId)
      ? menuMessage(userId, 'MENU_ONLY')
      : neutralMessage(userId);
  }

  async function handleCallback(callback, update) {
    const userId = privateCallbackUserId(callback);
    if (!userId) return result(200, 'PRIVATE_CHAT_REQUIRED');
    const binding = await stateStore.getBinding(userId);
    if (!binding) return neutralMessage(userId);
    const rate = await rateLimiter.assess(userId);
    if (!rate.allowed) {
      return result(200, 'RATE_LIMITED', [
        sendMessage(userId, 'Забагато дій. Спробуйте трохи пізніше.'),
      ]);
    }

    const choice = CHOICE_CALLBACK.exec(String(callback.data ?? ''));
    if (choice) {
      const selection = await stateStore.consumeOrderChoice({
        telegramUserId: userId,
        token: choice[1],
      });
      return selection
        ? menuMessage(userId, 'ORDER_SELECTED', `Обрано замовлення №${selection.orderReference || '—'}.`)
        : neutralMessage(userId);
    }

    const route = routeTelegramOrderMenuUpdate({ update, binding });
    if (route.operation === 'SHOW_MENU') return menuMessage(userId, 'MENU_ONLY');
    if (route.operation === 'LIST_ORDERS') return listOrders(userId, binding);
    if (route.operation === 'REQUEST_MANAGER') {
      return result(200, 'MANAGER_ACTION_REQUIRED', [
        internalAction('REQUEST_MANAGER', userId, binding.customerRef),
      ]);
    }
    if (route.operation === 'NOTIFICATION_SETTINGS') {
      return result(200, 'NOTIFICATION_SETTINGS_ACTION_REQUIRED', [
        internalAction('OPEN_NOTIFICATION_SETTINGS', userId, binding.customerRef),
      ]);
    }
    if (!route.requiresOrderRead) {
      const rendered = renderTelegramOrderResponse({ operation: route.operation, locale: 'uk' });
      return result(200, rendered.code, [sendMessage(userId, rendered.text, menuMarkup())]);
    }
    return renderSelectedOrder(userId, binding, route.operation);
  }

  async function listOrders(userId, binding) {
    const response = await orderService.listOwnedOrders({ binding, limit: 10 });
    const orders = Array.isArray(response?.orders) ? response.orders.slice(0, 10) : [];
    const choices = [];
    for (const candidate of orders) {
      if (!candidate?.order || !/^[1-9]\d{0,18}$/u.test(String(candidate.sourceOrderId ?? ''))) continue;
      const token = await stateStore.issueOrderChoice({
        telegramUserId: userId,
        customerRef: binding.customerRef,
        sourceOrderId: String(candidate.sourceOrderId),
        orderReference: candidate.order.orderReference,
      });
      if (token) {
        choices.push({
          text: `№${candidate.order.orderReference}`,
          callbackData: `order:select:${token}`,
        });
      }
    }
    if (!choices.length) return neutralMessage(userId);
    return result(200, 'ORDER_LIST', [
      sendMessage(userId, 'Оберіть замовлення:', {
        inlineKeyboard: choices.map((item) => [item]),
      }),
    ]);
  }

  async function renderSelectedOrder(userId, binding, operation) {
    const selection = await stateStore.getSelection(userId);
    if (!selection || selection.customerRef !== binding.customerRef) return neutralMessage(userId);
    const proofSessionId = await stateStore.issueLookupGrant({ telegramUserId: userId, selection });
    if (!proofSessionId) return neutralMessage(userId);
    const grant = await stateStore.consumeLookupGrant({ telegramUserId: userId, proofSessionId });
    if (!grant) return neutralMessage(userId);

    const source = await orderService.getOwnedOrder({
      sourceOrderId: grant.sourceOrderId,
      binding,
      ownershipProof: grant.proof,
    });
    const rendered = renderTelegramOrderResponse({
      operation,
      order: source?.ok ? source.order : null,
      locale: 'uk',
    });
    return result(200, rendered.code, [sendMessage(userId, rendered.text, menuMarkup())]);
  }

  return Object.freeze({ handle });
}

function menuMessage(chatId, code, prefix = '') {
  const text = [prefix, 'Оберіть потрібну дію кнопкою меню.'].filter(Boolean).join('\n');
  return result(200, code, [sendMessage(chatId, text, menuMarkup())]);
}

function neutralMessage(chatId) {
  return result(200, 'ORDER_NOT_AVAILABLE', [
    sendMessage(chatId, 'Інформація про замовлення зараз недоступна.'),
  ]);
}

function menuMarkup() {
  return {
    inlineKeyboard: TELEGRAM_ORDER_MENU.map((item) => [{
      text: item.text,
      callbackData: item.callbackData,
    }]),
  };
}

function sendMessage(chatId, text, replyMarkup) {
  return Object.freeze({
    type: 'SEND_MESSAGE',
    chatId: String(chatId),
    text,
    ...(replyMarkup ? { replyMarkup } : {}),
  });
}

function internalAction(type, telegramUserId, customerRef) {
  return Object.freeze({
    type,
    telegramUserId: String(telegramUserId),
    customerRef: String(customerRef),
  });
}

function result(httpStatus, code, actions = []) {
  return Object.freeze({ httpStatus, code, actions: Object.freeze(actions) });
}

function parseStartToken(text) {
  const match = /^\/start\s+([A-Za-z0-9_-]{32})$/u.exec(String(text ?? '').trim());
  return match && START_TOKEN.test(match[1]) ? match[1] : null;
}

function privateUserId(message) {
  const from = normalizeTelegramId(message?.from?.id);
  const chat = normalizeTelegramId(message?.chat?.id);
  return message?.chat?.type === 'private' && from && from === chat ? from : null;
}

function privateCallbackUserId(callback) {
  const from = normalizeTelegramId(callback?.from?.id);
  const chat = normalizeTelegramId(callback?.message?.chat?.id);
  return callback?.message?.chat?.type === 'private' && from && from === chat ? from : null;
}

function normalizeTelegramId(value) {
  const normalized = String(value ?? '');
  return TELEGRAM_ID.test(normalized) ? normalized : null;
}

function safeSecretEquals(expected, actual) {
  const left = createHash('sha256').update(expected).digest();
  const right = createHash('sha256').update(String(actual ?? '')).digest();
  return timingSafeEqual(left, right);
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
