import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { assessSecurityMaintenance, TRACKED_SECRET_MARKER_PATTERN } from '../security-maintenance.mjs';

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

test('tracked-secret scanner pattern does not match its own source while retaining all marker families', async () => {
  const scanner = await readFile(new URL('../scripts/security-maintenance.mjs', import.meta.url), 'utf8');
  const selfMatch = ['OPENAI_API_KEY', '=', '[^[:space:]]+'].join('');
  assert.equal(scanner.includes(selfMatch), false);
  assert.equal(TRACKED_SECRET_MARKER_PATTERN.includes('sk-proj-'), true);
  assert.equal(TRACKED_SECRET_MARKER_PATTERN.includes('OPENAI_API_KEY'), true);
  assert.equal(TRACKED_SECRET_MARKER_PATTERN.includes('TELEGRAM_ORDER_BOT_TOKEN'), true);
});
