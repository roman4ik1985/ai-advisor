import test from 'node:test';
import assert from 'node:assert/strict';
import { createTelegramOrderWebhook } from '../telegram-order-webhook.mjs';

const NOW = Date.parse('2026-07-29T06:00:00.000Z');
const SECRET = 'synthetic_webhook_secret_123';
const TOKEN = Buffer.alloc(24, 7).toString('base64url');

function fakeState() {
  const claimed = new Set();
  const choices = new Map();
  let binding = null;
  let selection = null;
  const pending = {
    token: TOKEN,
    linkSession: {
      version: '1.0',
      token: TOKEN,
      createdAt: '2026-07-29T05:55:00.000Z',
      expiresAt: '2026-07-29T06:05:00.000Z',
      consumedAt: null,
    },
    customerRef: 'salesdrive:counterparty:56',
    expectedPhone: '+380671234567',
  };
  return {
    async claimUpdate(id) {
      if (claimed.has(id)) return false;
      claimed.add(id);
      return true;
    },
    async beginLink({ telegramUserId, token }) {
      return telegramUserId === '100200300' && token === TOKEN ? pending : null;
    },
    async getPendingLink() { return pending; },
    async completeBinding(input) {
      binding = input.binding;
      return true;
    },
    async getBinding() { return binding; },
    async issueOrderChoice(input) {
      const token = Buffer.alloc(24, choices.size + 10).toString('base64url');
      choices.set(token, input);
      return token;
    },
    async consumeOrderChoice({ telegramUserId, token }) {
      const choice = choices.get(token);
      choices.delete(token);
      if (!choice || choice.telegramUserId !== telegramUserId) return null;
      selection = { ...choice, selectedAt: new Date(NOW).toISOString() };
      return selection;
    },
    async getSelection() { return selection; },
    async issueLookupGrant() { return TOKEN; },
    async consumeLookupGrant() {
      return selection ? {
        telegramUserId: '100200300',
        customerRef: selection.customerRef,
        sourceOrderId: selection.sourceOrderId,
        proof: {
          version: '1.2',
          state: 'VERIFIED',
          purpose: 'ORDER_STATUS',
          proofSessionId: TOKEN,
          verifiedAt: '2026-07-29T05:55:00.000Z',
          expiresAt: '2026-07-29T06:05:00.000Z',
          consumedAt: null,
          telegramBindingVerified: true,
          orderOwnershipVerified: true,
        },
      } : null;
    },
    setBinding(value) { binding = value; },
  };
}

function messageUpdate(updateId, message) {
  return {
    update_id: updateId,
    message: {
      from: { id: 100200300 },
      chat: { id: 100200300, type: 'private' },
      ...message,
    },
  };
}

function callbackUpdate(updateId, data) {
  return {
    update_id: updateId,
    callback_query: {
      id: `callback-${updateId}`,
      data,
      from: { id: 100200300 },
      message: { chat: { id: 100200300, type: 'private' } },
    },
  };
}

function orderDto() {
  return {
    schemaVersion: '1.0',
    orderReference: 'OC-1042',
    status: { label: 'Передано в доставку' },
    payment: { status: 'PAID', total: 2400, remaining: 0, currency: 'UAH' },
    delivery: { method: 'Нова пошта', city: 'Київ', branch: '№151', trackingNumber: '20450000000000' },
  };
}

function fixture({ rateAllowed = true } = {}) {
  const state = fakeState();
  const calls = { list: 0, get: 0 };
  let allowRate = rateAllowed;
  const orderService = {
    async listOwnedOrders() {
      calls.list += 1;
      return { orders: [{ sourceOrderId: '771', order: orderDto() }] };
    },
    async getOwnedOrder(input) {
      calls.get += 1;
      assert.equal(input.sourceOrderId, '771');
      assert.equal(input.ownershipProof.orderOwnershipVerified, true);
      return { ok: true, order: orderDto() };
    },
  };
  const webhook = createTelegramOrderWebhook({
    secretToken: SECRET,
    stateStore: state,
    rateLimiter: { assess: async () => ({ allowed: allowRate, retryAfterMs: 0 }) },
    orderService,
    now: () => NOW,
  });
  return { webhook, state, calls, setRateAllowed(value) { allowRate = value; } };
}

async function link(fx) {
  const start = await fx.webhook.handle({
    secretHeader: SECRET,
    update: messageUpdate(1, { text: `/start ${TOKEN}` }),
  });
  assert.equal(start.code, 'CONTACT_REQUIRED');
  const contact = await fx.webhook.handle({
    secretHeader: SECRET,
    update: messageUpdate(2, {
      contact: { user_id: 100200300, phone_number: '+380671234567' },
    }),
  });
  assert.equal(contact.code, 'TELEGRAM_CUSTOMER_LINKED');
}

test('webhook authenticates the secret and deduplicates Telegram updates', async () => {
  const fx = fixture();
  const unauthorized = await fx.webhook.handle({
    secretHeader: 'wrong_secret_value',
    update: messageUpdate(1, { text: `/start ${TOKEN}` }),
  });
  assert.deepEqual(unauthorized, { httpStatus: 401, code: 'WEBHOOK_UNAUTHORIZED', actions: [] });
  const first = await fx.webhook.handle({
    secretHeader: SECRET,
    update: messageUpdate(1, { text: `/start ${TOKEN}` }),
  });
  assert.equal(first.code, 'CONTACT_REQUIRED');
  const duplicate = await fx.webhook.handle({
    secretHeader: SECRET,
    update: messageUpdate(1, { text: `/start ${TOKEN}` }),
  });
  assert.equal(duplicate.code, 'WEBHOOK_DUPLICATE');
  assert.deepEqual(duplicate.actions, []);
});

test('start and own request_contact establish a private phone-free binding', async () => {
  const fx = fixture();
  await link(fx);
  const menu = await fx.webhook.handle({
    secretHeader: SECRET,
    update: messageUpdate(3, { text: 'Де замовлення?' }),
  });
  assert.equal(menu.code, 'MENU_ONLY');
  assert.equal(menu.actions[0].replyMarkup.inlineKeyboard.length, 6);
  assert.equal(fx.calls.list, 0);
  assert.equal(fx.calls.get, 0);
});

test('list, opaque selection, and status form a deterministic ownership-gated path', async () => {
  const fx = fixture();
  await link(fx);
  const listed = await fx.webhook.handle({
    secretHeader: SECRET,
    update: callbackUpdate(3, 'order:list'),
  });
  assert.equal(listed.code, 'ORDER_LIST');
  assert.equal(fx.calls.list, 1);
  const callbackData = listed.actions[0].replyMarkup.inlineKeyboard[0][0].callbackData;
  assert.match(callbackData, /^order:select:[A-Za-z0-9_-]{32}$/u);

  const selected = await fx.webhook.handle({
    secretHeader: SECRET,
    update: callbackUpdate(4, callbackData),
  });
  assert.equal(selected.code, 'ORDER_SELECTED');
  assert.equal(callbackData.includes('771'), false);
  assert.equal(callbackData.includes('OC-1042'), false);

  const status = await fx.webhook.handle({
    secretHeader: SECRET,
    update: callbackUpdate(5, 'order:status'),
  });
  assert.equal(status.code, 'ORDER_STATUS');
  assert.match(status.actions[0].text, /Передано в доставку/u);
  assert.equal(fx.calls.get, 1);
});

test('manager callback does not read orders and distributed rate denial blocks callbacks', async () => {
  const fx = fixture();
  await link(fx);
  const manager = await fx.webhook.handle({
    secretHeader: SECRET,
    update: callbackUpdate(3, 'order:manager'),
  });
  assert.equal(manager.code, 'MANAGER_ACTION_REQUIRED');
  assert.deepEqual(manager.actions, [{
    type: 'REQUEST_MANAGER',
    telegramUserId: '100200300',
    customerRef: 'salesdrive:counterparty:56',
  }]);
  assert.equal(fx.calls.get, 0);

  const limited = fixture();
  await link(limited);
  limited.setRateAllowed(false);
  const response = await limited.webhook.handle({
    secretHeader: SECRET,
    update: callbackUpdate(3, 'order:list'),
  });
  assert.equal(response.code, 'RATE_LIMITED');
  assert.equal(limited.calls.list, 0);
});

test('group, unknown callback, and absent selection fail closed', async () => {
  const grouped = fixture();
  const group = messageUpdate(1, { text: `/start ${TOKEN}` });
  group.message.chat = { id: -1001, type: 'group' };
  assert.equal((await grouped.webhook.handle({ secretHeader: SECRET, update: group })).code, 'PRIVATE_CHAT_REQUIRED');
  const fx = fixture();
  await link(fx);
  const unknown = await fx.webhook.handle({ secretHeader: SECRET, update: callbackUpdate(6, 'order:unknown') });
  assert.equal(unknown.code, 'MENU_ONLY');
  const noSelection = await fx.webhook.handle({ secretHeader: SECRET, update: callbackUpdate(7, 'order:payment') });
  assert.equal(noSelection.code, 'ORDER_NOT_AVAILABLE');
});
