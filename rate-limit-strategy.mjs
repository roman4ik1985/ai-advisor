export function decideRateLimitStrategy({
  instanceCount = 1,
  distributedConfigured = false,
} = {}) {
  const count = Number(instanceCount);
  if (!Number.isSafeInteger(count) || count < 1 || count > 100) {
    return Object.freeze({ status: 'BLOCKED', mode: 'INVALID_INSTANCE_COUNT', instanceCount: null });
  }
  if (count === 1) {
    return Object.freeze({
      status: 'READY',
      mode: 'LOCAL_FIXED_WINDOW',
      instanceCount: 1,
      distributedRequired: false,
    });
  }
  return Object.freeze({
    status: distributedConfigured ? 'READY' : 'BLOCKED',
    mode: distributedConfigured ? 'DISTRIBUTED_ATOMIC' : 'DISTRIBUTED_REQUIRED',
    instanceCount: count,
    distributedRequired: true,
  });
}
