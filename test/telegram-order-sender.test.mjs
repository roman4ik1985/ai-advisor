import test from 'node:test';
import assert from 'node:assert/strict';
import { createTelegramOrderSender } from '../telegram-order-sender.mjs';

const TOKEN = '123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghi';

test('Telegram sender posts only allow-listed methods and normalizes keyboards', async () => {
  const requests = [];
  const sender = createTelegramOrderSender({
    botToken: TOKEN,
    fetchImpl: async (url, options) => {
      requests.push({ url, options, body: JSON.parse(options.body) });
      return { ok: true, json: async () => ({ ok: true }) };
    },
  });
  assert.equal(await sender.dispatch({
    type: 'SEND_MESSAGE',
    chatId: '100200300',
    text: 'Menu',
    replyMarkup: {
      inlineKeyboard: [[{ text: 'Status', callbackData: 'order:status' }]],
    },
  }), true);
  assert.match(requests[0].url, /\/sendMessage$/u);
  assert.deepEqual(requests[0].body.reply_markup.inline_keyboard, [[{
    text: 'Status',
    callback_data: 'order:status',
  }]]);
  assert.equal(requests[0].options.redirect, 'error');
  assert.equal(await sender.dispatch({ type: 'DELETE_MESSAGE' }), false);
});

test('Telegram sender returns false without echoing upstream errors', async () => {
  const sender = createTelegramOrderSender({
    botToken: TOKEN,
    fetchImpl: async () => { throw new Error(`${TOKEN} upstream secret`); },
  });
  assert.equal(await sender.dispatch({
    type: 'ANSWER_CALLBACK',
    callbackQueryId: 'callback-1',
  }), false);
});
