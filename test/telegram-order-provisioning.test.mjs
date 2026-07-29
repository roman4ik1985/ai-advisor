import test from 'node:test';
import assert from 'node:assert/strict';
import { createTelegramOrderProvisioner } from '../telegram-order-provisioning.mjs';

function entropy(length) {
  return Buffer.alloc(length, length);
}

async function run(candidate) {
  let saved;
  const provisioner = createTelegramOrderProvisioner({
    candidateResolver: { resolveCandidate: async () => candidate },
    stateStore: { saveLink: async (record) => { saved = record; return true; } },
    botUsername: 'LedProjectorOrderBot',
    now: () => Date.parse('2026-07-29T08:00:00.000Z'),
    randomBytesFn: entropy,
  });
  return { result: await provisioner.provision({ orderReference: 'OC-1042' }), saved };
}

test('real candidate creates an expiring link with verified ownership inputs', async () => {
  const { result, saved } = await run({
    customerRef: 'salesdrive:counterparty:56',
    expectedPhone: '+380671234567',
    sourceOrderIds: ['771'],
  });
  assert.equal(result.code, 'TELEGRAM_ORDER_LINK_READY');
  assert.match(result.button.url, /^https:\/\/t\.me\/LedProjectorOrderBot\?start=[A-Za-z0-9_-]{32}$/u);
  assert.equal(saved.customerRef, 'salesdrive:counterparty:56');
  assert.deepEqual(saved.sourceOrderIds, ['771']);
  assert.equal(JSON.stringify(result).includes('56'), false);
  assert.equal(JSON.stringify(result).includes('771'), false);
  assert.equal(JSON.stringify(result).includes('+380'), false);
});

test('nonexistent order receives the same public shape and a decoy contact challenge', async () => {
  const real = await run({
    customerRef: 'salesdrive:counterparty:56',
    expectedPhone: '+380671234567',
    sourceOrderIds: ['771'],
  });
  const decoy = await run(null);
  assert.deepEqual(Object.keys(decoy.result), Object.keys(real.result));
  assert.deepEqual(Object.keys(decoy.result.button), Object.keys(real.result.button));
  assert.equal(decoy.result.code, real.result.code);
  assert.match(decoy.saved.customerRef, /^decoy:[a-f0-9]{24}$/u);
  assert.equal(decoy.saved.expectedPhone, 'invalid');
  assert.deepEqual(decoy.saved.sourceOrderIds, []);
});
