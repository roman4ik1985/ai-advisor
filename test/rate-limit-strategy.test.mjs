import test from 'node:test';
import assert from 'node:assert/strict';
import { decideRateLimitStrategy } from '../rate-limit-strategy.mjs';

test('C42 keeps the current single instance on local limiting', () => {
  assert.deepEqual(decideRateLimitStrategy({ instanceCount: 1 }), {
    status: 'READY',
    mode: 'LOCAL_FIXED_WINDOW',
    instanceCount: 1,
    distributedRequired: false,
  });
});

test('multi-instance startup is blocked until an atomic distributed limiter exists', () => {
  assert.deepEqual(decideRateLimitStrategy({ instanceCount: 2 }), {
    status: 'BLOCKED',
    mode: 'DISTRIBUTED_REQUIRED',
    instanceCount: 2,
    distributedRequired: true,
  });
  assert.equal(decideRateLimitStrategy({
    instanceCount: 2,
    distributedConfigured: true,
  }).mode, 'DISTRIBUTED_ATOMIC');
});
