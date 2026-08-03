import test from 'node:test';
import assert from 'node:assert/strict';
import { createTelegramOrderActionSink } from '../telegram-order-action-sink.mjs';

test('notification settings are persisted by the state store and confirmed privately', async () => {
  const calls = [];
  const sink = createTelegramOrderActionSink({
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
    sender: { async dispatch() { throw new Error('must not send'); } },
    stateStore: { async toggleNotifications() { return null; } },
  });
  assert.equal(await sink.dispatch({ type: 'ARBITRARY_QUERY' }), false);
  assert.equal(await sink.dispatch({
    type: 'REQUEST_MANAGER',
    telegramUserId: 'invalid',
    customerRef: 'customer:42',
  }), false);
  assert.equal(await sink.dispatch({
    type: 'REQUEST_MANAGER',
    telegramUserId: '100200300',
    customerRef: 'customer:42',
  }), false);
});
