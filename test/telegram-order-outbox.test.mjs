import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createTelegramOrderOutbox,
  TELEGRAM_ORDER_OUTBOX_CONTRACT,
} from '../telegram-order-outbox.mjs';

const ACTION = Object.freeze({
  type: 'SEND_MESSAGE',
  chatId: '100200300',
  text: 'Safe message',
});

test('outbox atomically deduplicates enqueue and acknowledges successful delivery', async () => {
  const commands = [];
  const dispatched = [];
  const outbox = createTelegramOrderOutbox({
    now: () => 1_000,
    sendCommand: async (args) => {
      commands.push(args);
      if (args[0] !== 'EVAL') return null;
      if (String(args[1]).includes('EXISTS')) return 1;
      if (String(args[1]).includes('ZRANGEBYSCORE')) {
        return ['telegram-update:1:0:SEND_MESSAGE', JSON.stringify(ACTION), '1'];
      }
      if (String(args[1]).includes("redis.call('DEL'")) return 1;
      return null;
    },
    dispatch: async (action) => {
      dispatched.push(action);
      return true;
    },
  });

  assert.equal(await outbox.enqueue({
    deliveryId: 'telegram-update:1:0:SEND_MESSAGE',
    action: ACTION,
  }), true);
  assert.deepEqual(await outbox.drainOne(), {
    status: 'DELIVERED',
    deliveryId: 'telegram-update:1:0:SEND_MESSAGE',
  });
  assert.deepEqual(dispatched, [ACTION]);
  assert.equal(commands.every((args) => args[0] === 'EVAL'), true);
  assert.equal(TELEGRAM_ORDER_OUTBOX_CONTRACT.enqueueDeduplication, true);
  assert.equal(TELEGRAM_ORDER_OUTBOX_CONTRACT.delivery, 'at-least-once');
});

test('outbox leaves a failed delivery under visibility timeout for retry', async () => {
  const outbox = createTelegramOrderOutbox({
    sendCommand: async (args) => {
      if (String(args[1]).includes('ZRANGEBYSCORE')) {
        return ['telegram-update:2:0:SEND_MESSAGE', JSON.stringify(ACTION), '2'];
      }
      return 1;
    },
    dispatch: async () => false,
  });
  assert.deepEqual(await outbox.drainOne(), {
    status: 'RETRY_SCHEDULED',
    deliveryId: 'telegram-update:2:0:SEND_MESSAGE',
  });
});

test('outbox rejects unknown actions and fails closed when Redis is unavailable', async () => {
  const outbox = createTelegramOrderOutbox({
    sendCommand: async () => { throw new Error('redis contains secret payload'); },
    dispatch: async () => true,
  });
  assert.equal(await outbox.enqueue({
    deliveryId: 'telegram-update:3:0:DELETE_MESSAGE',
    action: { type: 'DELETE_MESSAGE', chatId: '100200300' },
  }), false);
  assert.deepEqual(await outbox.drainOne(), { status: 'UNAVAILABLE' });
});
