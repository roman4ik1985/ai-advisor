import test from 'node:test';
import assert from 'node:assert/strict';
import { assessSecurityMaintenance } from '../security-maintenance.mjs';

const headers = ['Content-Security-Policy', 'X-Content-Type-Options', 'Referrer-Policy'];

test('C43 passes a zero-vulnerability, secret-free, header-complete scan', () => {
  assert.deepEqual(assessSecurityMaintenance({
    audit: { metadata: { vulnerabilities: {} } },
    securityHeaders: headers,
  }), {
    status: 'PASS',
    findings: [],
    blockingCount: 0,
    nextReviewDays: 30,
  });
});

test('high vulnerabilities, tracked secret markers, and missing headers block release', () => {
  const report = assessSecurityMaintenance({
    audit: { metadata: { vulnerabilities: { high: 1 } } },
    secretFiles: ['public/config.js'],
    securityHeaders: [],
  });
  assert.equal(report.status, 'BLOCKED');
  assert.equal(report.blockingCount, 3);
});
