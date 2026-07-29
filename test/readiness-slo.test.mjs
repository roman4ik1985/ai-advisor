import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReadinessSnapshot, evaluateSlo } from '../readiness-slo.mjs';

test('C41 readiness is separate from liveness and fails closed on capacity or dependency state', () => {
  const ready = buildReadinessSnapshot({
    providerConfigured: true,
    queueActive: 1,
    queueQueued: 0,
    maxConcurrent: 4,
    maxQueue: 16,
    rateLimitStrategy: { status: 'READY' },
    now: () => new Date('2026-07-29T12:00:00Z'),
  });
  assert.equal(ready.status, 'READY');
  const blocked = buildReadinessSnapshot({
    providerConfigured: true,
    queueActive: 4,
    queueQueued: 16,
    maxConcurrent: 4,
    maxQueue: 16,
    rateLimitStrategy: { status: 'READY' },
  });
  assert.equal(blocked.status, 'NOT_READY');
  assert.equal(blocked.checks.capacity, 'FAIL');
});

test('SLO evaluation exposes stable indicators and rollout consequence', () => {
  const pass = evaluateSlo(Array.from({ length: 200 }, () => ({
    available: true,
    successful: true,
    latencyMs: 500,
  })));
  assert.equal(pass.status, 'PASS');
  const breach = evaluateSlo([
    { available: false, successful: false, latencyMs: 20_000 },
    { available: true, successful: true, latencyMs: 500 },
  ]);
  assert.equal(breach.status, 'BREACHED');
  assert.equal(breach.consequence, 'FREEZE_ROLLOUT_AND_REVIEW_ERROR_BUDGET');
});
