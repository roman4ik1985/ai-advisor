import test from 'node:test';
import assert from 'node:assert/strict';
import { assessPerformanceBudget } from '../performance-budget.mjs';

test('C45 enforces maintainable asset and Web Vitals budgets', () => {
  const report = assessPerformanceBudget({
    assets: { widgetJsBytes: 60_000, widgetCssBytes: 20_000 },
    webVitals: { lcpMs: 2_000, cls: 0.05, inpMs: 150 },
  });
  assert.equal(report.status, 'PASS');
  assert.equal(report.webVitals.status, 'PASS');
});

test('source assets can pass while staging Web Vitals remain explicitly pending', () => {
  const report = assessPerformanceBudget({
    assets: { widgetJsBytes: 60_000, widgetCssBytes: 20_000 },
  });
  assert.equal(report.status, 'PASS');
  assert.equal(report.webVitals.status, 'STAGING_REQUIRED');
  const failed = assessPerformanceBudget({
    assets: { widgetJsBytes: 200_000, widgetCssBytes: 20_000 },
  });
  assert.equal(failed.status, 'FAIL');
});
