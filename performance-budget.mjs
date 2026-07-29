export const PERFORMANCE_BUDGETS = Object.freeze({
  assets: Object.freeze({
    widgetJsBytes: 120_000,
    widgetCssBytes: 50_000,
  }),
  webVitals: Object.freeze({
    lcpMs: 2_500,
    cls: 0.1,
    inpMs: 200,
  }),
});

export function assessPerformanceBudget({
  assets = {},
  webVitals = null,
  budgets = PERFORMANCE_BUDGETS,
} = {}) {
  const assetViolations = [];
  for (const [metric, limit] of Object.entries(budgets.assets)) {
    const value = Number(assets[metric]);
    if (!Number.isFinite(value) || value > limit) assetViolations.push(metric);
  }
  const vitalViolations = [];
  if (webVitals) {
    for (const [metric, limit] of Object.entries(budgets.webVitals)) {
      const value = Number(webVitals[metric]);
      if (!Number.isFinite(value) || value > limit) vitalViolations.push(metric);
    }
  }
  return Object.freeze({
    status: assetViolations.length || vitalViolations.length ? 'FAIL' : 'PASS',
    assets: Object.freeze({ values: Object.freeze({ ...assets }), violations: Object.freeze(assetViolations) }),
    webVitals: Object.freeze({
      status: webVitals ? (vitalViolations.length ? 'FAIL' : 'PASS') : 'STAGING_REQUIRED',
      values: webVitals ? Object.freeze({ ...webVitals }) : null,
      violations: Object.freeze(vitalViolations),
    }),
    budgets,
  });
}
