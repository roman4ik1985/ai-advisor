export const AI_ADVISOR_SLO = Object.freeze({
  availabilityPercent: 99.5,
  successfulResponsePercent: 98,
  p95LatencyMs: 15_000,
  windowDays: 30,
});

export function buildReadinessSnapshot({
  shuttingDown = false,
  providerConfigured = false,
  queueActive = 0,
  queueQueued = 0,
  maxConcurrent = 1,
  maxQueue = 0,
  rateLimitStrategy,
  telegramEnabled = false,
  telegramReady = false,
  now = () => new Date(),
} = {}) {
  const checks = Object.freeze({
    lifecycle: shuttingDown ? 'FAIL' : 'PASS',
    provider: providerConfigured ? 'PASS' : 'FAIL',
    capacity: queueActive < maxConcurrent || queueQueued < maxQueue ? 'PASS' : 'FAIL',
    rateLimit: rateLimitStrategy?.status === 'READY' ? 'PASS' : 'FAIL',
    telegram: !telegramEnabled || telegramReady ? 'PASS' : 'FAIL',
  });
  const ready = Object.values(checks).every((value) => value === 'PASS');
  return Object.freeze({
    ready,
    status: ready ? 'READY' : 'NOT_READY',
    checkedAt: now().toISOString(),
    checks,
  });
}

export function evaluateSlo(samples, targets = AI_ADVISOR_SLO) {
  const valid = (Array.isArray(samples) ? samples : []).filter((item) => (
    typeof item?.available === 'boolean'
    && typeof item?.successful === 'boolean'
    && Number.isFinite(item?.latencyMs)
    && item.latencyMs >= 0
  ));
  if (valid.length === 0) {
    return Object.freeze({ status: 'NO_DATA', sampleCount: 0, targets });
  }
  const availabilityPercent = percent(valid.filter((item) => item.available).length, valid.length);
  const successfulResponsePercent = percent(valid.filter((item) => item.successful).length, valid.length);
  const p95LatencyMs = percentile(valid.map((item) => item.latencyMs), 0.95);
  const violations = [];
  if (availabilityPercent < targets.availabilityPercent) violations.push('AVAILABILITY');
  if (successfulResponsePercent < targets.successfulResponsePercent) violations.push('SUCCESS_RATE');
  if (p95LatencyMs > targets.p95LatencyMs) violations.push('P95_LATENCY');
  return Object.freeze({
    status: violations.length ? 'BREACHED' : 'PASS',
    sampleCount: valid.length,
    indicators: Object.freeze({ availabilityPercent, successfulResponsePercent, p95LatencyMs }),
    targets,
    violations: Object.freeze(violations),
    consequence: violations.length ? 'FREEZE_ROLLOUT_AND_REVIEW_ERROR_BUDGET' : 'CONTINUE_MONITORING',
  });
}

function percent(value, total) {
  return Number(((value / total) * 100).toFixed(3));
}

function percentile(values, percentileValue) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * percentileValue) - 1)];
}
