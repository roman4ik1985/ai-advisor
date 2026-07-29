import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assessProductionMonitor,
  extractLightningScriptUrls,
  inspectWidgetBundle,
  PRODUCTION_WIDGET_ROUTES,
  runProductionMonitor,
} from '../production-widget-monitor.mjs';

const bundleUrl = 'https://ledprojector.com.ua/image/cache/lightning/widget123cs.js';
const widgetBody = `${'x'.repeat(20_100)}lp-agent-root https://ai.ledprojector.com.ua/api/chat`;

test('C60 extracts only same-origin Lightning JavaScript assets', () => {
  const urls = extractLightningScriptUrls(`
    <script src="/image/cache/lightning/widget123cs.js"></script>
    <script src="https://evil.example/widget.js"></script>
    <link href="/image/cache/lightning/theme.css">
  `);
  assert.deepEqual(urls, [bundleUrl]);
});

test('C60 rejects a stale or partial immutable widget bundle', () => {
  const report = inspectWidgetBundle({
    url: bundleUrl,
    normalBody: '\n;',
    bypassBody: widgetBody,
  });
  assert.equal(report.status, 'FAIL');
  assert.ok(report.violations.includes('IMMUTABLE_BUNDLE_MISMATCH'));
});

test('C60 ignores unrelated Lightning JavaScript bundles without false violations', () => {
  const body = 'ordinary storefront JavaScript'.repeat(1_000);
  const report = inspectWidgetBundle({
    url: 'https://ledprojector.com.ua/image/cache/lightning/storefront.js',
    normalBody: body,
    bypassBody: body,
  });
  assert.equal(report.status, 'NOT_WIDGET');
  assert.deepEqual(report.violations, []);
});

test('C61-C64 pass complete HTTP, browser, vitals, and error gates', () => {
  const routeReports = PRODUCTION_WIDGET_ROUTES.map((route) => ({
    route,
    status: 'PASS',
  }));
  const bundleReports = [inspectWidgetBundle({
    url: bundleUrl,
    normalBody: widgetBody,
    bypassBody: widgetBody,
  })];
  const browserReport = {
    status: 'PASS',
    routes: PRODUCTION_WIDGET_ROUTES.map((route) => ({ route, mounted: true })),
    mobile: {
      mounted: true,
      webVitals: { lcpMs: 964, cls: 0, inpMs: 0 },
    },
    errors: [],
  };
  const report = assessProductionMonitor({ routeReports, bundleReports, browserReport });
  assert.equal(report.status, 'PASS');
  assert.equal(report.consequence, 'CONTINUE_MONITORING');
});

test('C63 freezes rollout on vitals or browser errors', () => {
  const report = assessProductionMonitor({
    routeReports: PRODUCTION_WIDGET_ROUTES.map((route) => ({ route, status: 'PASS' })),
    bundleReports: [inspectWidgetBundle({
      url: bundleUrl,
      normalBody: widgetBody,
      bypassBody: widgetBody,
    })],
    browserReport: {
      status: 'FAIL',
      routes: PRODUCTION_WIDGET_ROUTES.map((route) => ({ route, mounted: true })),
      mobile: {
        mounted: true,
        webVitals: { lcpMs: 3_000, cls: 0.2, inpMs: 250 },
      },
      errors: ['RUNTIME_EXCEPTION'],
    },
  });
  assert.equal(report.status, 'FAIL');
  assert.equal(report.consequence, 'FREEZE_ROLLOUT_AND_USE_ROLLBACK_RUNBOOK');
  assert.ok(report.violations.includes('LCP'));
  assert.ok(report.violations.includes('CLS'));
  assert.ok(report.violations.includes('INP'));
  assert.ok(report.violations.includes('BROWSER_ERRORS'));
});

test('production monitor uses only fixed routes and detects the widget bundle', async () => {
  const fetchImpl = async (input) => {
    const url = new URL(input);
    if (url.pathname.startsWith('/image/cache/lightning/')) {
      return new Response(widgetBody, {
        status: 200,
        headers: { 'content-type': 'text/javascript' },
      });
    }
    return new Response(`<script src="${bundleUrl}"></script>`, {
      status: 200,
      headers: { 'content-type': 'text/html' },
    });
  };
  const browserProbe = async () => ({
    status: 'PASS',
    routes: PRODUCTION_WIDGET_ROUTES.map((route) => ({ route, mounted: true })),
    mobile: {
      mounted: true,
      webVitals: { lcpMs: 1_000, cls: 0, inpMs: 10 },
    },
    errors: [],
  });
  const report = await runProductionMonitor({
    fetchImpl,
    browserProbe,
    now: () => new Date('2026-07-29T11:00:00Z'),
  });
  assert.equal(report.status, 'PASS');
  assert.equal(report.routes.length, 5);
  assert.equal(report.bundles.filter((item) => item.markers?.bypass).length, 1);
});
