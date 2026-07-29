import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ORDER_OWNERSHIP_CONTRACT,
  assessOrderOwnershipProof,
  toPublicOwnershipResult,
} from '../order-ownership-contract.mjs';

const NOW = Date.parse('2026-07-29T04:00:00.000Z');

function verifiedProof(overrides = {}) {
  return {
    version: '1.2',
    state: 'VERIFIED',
    purpose: 'ORDER_STATUS',
    proofSessionId: 'proof_session_0123456789abcdef',
    verifiedAt: '2026-07-29T03:55:00.000Z',
    expiresAt: '2026-07-29T04:05:00.000Z',
    consumedAt: null,
    telegramBindingVerified: true,
    orderOwnershipVerified: true,
    ...overrides,
  };
}

test('C20 contract explicitly forbids anonymous lookup and raw customer data', () => {
  assert.equal(ORDER_OWNERSHIP_CONTRACT.version, '1.2');
  assert.ok(ORDER_OWNERSHIP_CONTRACT.forbids.includes('anonymous order lookup'));
  assert.ok(ORDER_OWNERSHIP_CONTRACT.forbids.some((rule) => rule.includes('raw order or customer data')));
  assert.ok(ORDER_OWNERSHIP_CONTRACT.requires.includes('single use before order lookup'));
});

test('a complete fresh server-bound proof authorizes only the next lookup gate', () => {
  assert.deepEqual(
    assessOrderOwnershipProof(verifiedProof(), { now: NOW }),
    {
      contractVersion: '1.2',
      decision: 'ALLOW_LOOKUP',
      publicCode: 'OWNERSHIP_VERIFIED',
      canLookupOrder: true,
      requiresAtomicConsumption: true,
    },
  );
});

test('missing proof and every non-verified state fail closed identically', () => {
  const candidates = [
    null,
    {},
    ...ORDER_OWNERSHIP_CONTRACT.proofStates
      .filter((state) => state !== 'VERIFIED')
      .map((state) => verifiedProof({ state })),
  ];
  const decisions = candidates.map((candidate) => assessOrderOwnershipProof(candidate, { now: NOW }));
  assert.ok(decisions.every((decision) => decision === decisions[0]));
  assert.equal(decisions[0].canLookupOrder, false);
});

test('verified Telegram customer binding and backend order ownership are mandatory', () => {
  assert.equal(
    assessOrderOwnershipProof(verifiedProof({ telegramBindingVerified: false }), { now: NOW }).canLookupOrder,
    false,
  );
  assert.equal(
    assessOrderOwnershipProof(verifiedProof({ orderOwnershipVerified: false }), { now: NOW }).canLookupOrder,
    false,
  );
});

test('expired, future-dated, malformed, and overlong proofs fail closed', () => {
  const invalidProofs = [
    verifiedProof({ expiresAt: '2026-07-29T04:00:00.000Z' }),
    verifiedProof({ verifiedAt: '2026-07-29T04:00:31.000Z', expiresAt: '2026-07-29T04:05:00.000Z' }),
    verifiedProof({ verifiedAt: 'invalid' }),
    verifiedProof({ verifiedAt: '2026-07-29T03:49:59.000Z' }),
  ];
  for (const proof of invalidProofs) {
    assert.equal(assessOrderOwnershipProof(proof, { now: NOW }).canLookupOrder, false);
  }
});

test('consumed proof is rejected to make replay fail closed', () => {
  const decision = assessOrderOwnershipProof(
    verifiedProof({ consumedAt: '2026-07-29T03:56:00.000Z' }),
    { now: NOW },
  );
  assert.equal(decision.canLookupOrder, false);
});

test('opaque proof session id is mandatory and bounded', () => {
  for (const proofSessionId of ['', 'short', 'contains customer@example.com', 'x'.repeat(129)]) {
    const decision = assessOrderOwnershipProof(verifiedProof({ proofSessionId }), { now: NOW });
    assert.equal(decision.canLookupOrder, false);
  }
});

test('unknown fields are rejected so order and customer data cannot enter the envelope', () => {
  for (const extra of [
    { orderId: '123' },
    { orderExists: true },
    { customerPhone: '+380000000000' },
    { status: 'shipped' },
  ]) {
    const decision = assessOrderOwnershipProof(verifiedProof(extra), { now: NOW });
    assert.equal(decision.canLookupOrder, false);
    assert.equal(JSON.stringify(decision).includes(Object.values(extra)[0]), false);
  }
});

test('public denial is anti-enumeration neutral across all failure causes', () => {
  const failures = [
    null,
    verifiedProof({ state: 'DENIED' }),
    verifiedProof({ expiresAt: '2026-07-29T03:59:59.000Z' }),
    verifiedProof({ orderExists: false }),
  ];
  const publicResults = failures.map((proof) => (
    toPublicOwnershipResult(assessOrderOwnershipProof(proof, { now: NOW }), 'uk')
  ));
  assert.ok(publicResults.every((result) => (
    JSON.stringify(result) === JSON.stringify(publicResults[0])
  )));
  assert.equal(publicResults[0].code, 'OWNERSHIP_VERIFICATION_REQUIRED');
  assert.doesNotMatch(publicResults[0].message, /існу|не знай|номер|контакт/i);
});

test('public success confirms proof only and does not expose order facts', () => {
  const result = toPublicOwnershipResult(
    assessOrderOwnershipProof(verifiedProof(), { now: NOW }),
    'ru',
  );
  assert.deepEqual(result, {
    code: 'OWNERSHIP_VERIFIED',
    message: 'Право на просмотр заказа подтверждено.',
  });
  assert.doesNotMatch(JSON.stringify(result), /orderId|status|payment|delivery|customer/i);
});

test('public formatter rejects a structurally forged allow decision', () => {
  const result = toPublicOwnershipResult({
    contractVersion: '1.2',
    decision: 'ALLOW_LOOKUP',
    publicCode: 'OWNERSHIP_VERIFIED',
    canLookupOrder: true,
    requiresAtomicConsumption: true,
  });
  assert.equal(result.code, 'OWNERSHIP_VERIFICATION_REQUIRED');
});
