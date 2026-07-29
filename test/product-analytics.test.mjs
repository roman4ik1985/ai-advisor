import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createProductAnalytics,
  normalizeProductAnalyticsEvent,
  PRODUCT_ANALYTICS_CONTRACT,
  retainProductAnalytics,
} from '../product-analytics.mjs';

test('C40 accepts only product events with no visitor identity or free text', async () => {
  const writes = [];
  const analytics = createProductAnalytics({
    enabled: true,
    path: 'C:\\tmp\\product-analytics.jsonl',
    now: () => new Date('2026-07-29T12:00:00Z'),
    append: async (...args) => writes.push(args),
  });
  assert.equal(await analytics.record({
    eventType: 'PRODUCT_CARD_OPENED',
    productKey: 'sku:DEMO-1',
  }), true);
  assert.equal(writes.length, 1);
  assert.doesNotMatch(writes[0][1], /ip|cookie|session|question|answer/iu);
  assert.equal(normalizeProductAnalyticsEvent({
    eventType: 'PRODUCT_CARD_OPENED',
    productKey: 'DEMO-1',
    email: 'visitor@example.com',
  }), null);
  assert.equal(PRODUCT_ANALYTICS_CONTRACT.retentionDays, 30);
});

test('analytics retention drops expired, corrupt, and unknown records', () => {
  const current = JSON.stringify(normalizeProductAnalyticsEvent({
    eventType: 'PRODUCT_CARD_SHOWN',
    productKey: 'DEMO-1',
  }, new Date('2026-07-20T00:00:00Z')));
  const expired = JSON.stringify(normalizeProductAnalyticsEvent({
    eventType: 'PRODUCT_CARD_SHOWN',
    productKey: 'DEMO-2',
  }, new Date('2026-05-01T00:00:00Z')));
  const result = retainProductAnalytics(`${current}\n${expired}\n{bad`, {
    now: () => new Date('2026-07-29T00:00:00Z'),
  });
  assert.equal(result.retained.length, 1);
  assert.equal(result.dropped, 2);
});
