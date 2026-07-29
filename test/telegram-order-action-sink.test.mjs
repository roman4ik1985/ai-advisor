import test from 'node:test';
import assert from 'node:assert/strict';
import { createTelegramOrderActionSink } from '../telegram-order-action-sink.mjs';

test('manager sink sends a bounded request without order, phone, or conversation data', async () => {
  const sent = [];
  const sink = createTelegramOrderActionSink({
    managerChatId: '900800700',
    sender: {
      async dispatch(action) {
        sent.push(action);
        return true;
      },
    },
    stateStore: { async toggleNotifications() { return true; } },
  });
  assert.equal(await sink.dispatch({
    type: 'REQUEST_MANAGER',
    telegramUserId: '100200300',
    customerRef: 'salesdrive:counterparty:42',
  }), true);
  assert.equal(sent.length, 2);
  assert.equal(sent[0].chatId, '900800700');
  assert.match(sent[0].text, /salesdrive:counterparty:42/u);
  assert.doesNotMatch(sent[0].text, /телефон|замовлення|істор/u);
  assert.equal(sent[1].chatId, '100200300');
});

test('notification settings are persisted by the state store and confirmed privately', async () => {
  const calls = [];
  const sink = createTelegramOrderActionSink({
    managerChatId: '900800700',
    sender: {
      async dispatch(action) {
        calls.push(action);
        return true;
      },
    },
    stateStore: {
      async toggleNotifications(input) {
        calls.push(input);
        return false;
      },
    },
  });
  assert.equal(await sink.dispatch({
    type: 'OPEN_NOTIFICATION_SETTINGS',
    telegramUserId: '100200300',
    customerRef: 'customer:42',
  }), true);
  assert.deepEqual(calls[0], {
    telegramUserId: '100200300',
    customerRef: 'customer:42',
  });
  assert.match(calls[1].text, /вимкнено/u);
});

test('action sink rejects unsupported or malformed operations', async () => {
  const sink = createTelegramOrderActionSink({
    managerChatId: '900800700',
    sender: { async dispatch() { throw new Error('must not send'); } },
    stateStore: { async toggleNotifications() { return null; } },
  });
  assert.equal(await sink.dispatch({ type: 'ARBITRARY_QUERY' }), false);
  assert.equal(await sink.dispatch({
    type: 'REQUEST_MANAGER',
    telegramUserId: 'invalid',
    customerRef: 'customer:42',
  }), false);
});
