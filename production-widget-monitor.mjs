import { createHash } from 'node:crypto';
import { PERFORMANCE_BUDGETS } from './performance-budget.mjs';

export const PRODUCTION_WIDGET_ROUTES = Object.freeze([
  '/',
  '/proektory',
  '/jenovox-m4000',
  '/index.php?route=checkout/cart',
  '/index.php?route=checkout/checkout',
]);

export const PRODUCTION_MONITOR_TARGETS = Object.freeze({
  baseUrl: 'https://ledprojector.com.ua',
  widgetBundleMinBytes: 20_000,
  widgetMarkers: Object.freeze([
    'lp-agent-root',
    'https://ai.ledprojector.com.ua/api/chat',
  ]),
  webVitals: PERFORMANCE_BUDGETS.webVitals,
});

export function extractLightningScriptUrls(html, baseUrl = PRODUCTION_MONITOR_TARGETS.baseUrl) {
  const source = String(html || '');
  const urls = [];
  const pattern = /<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/giu;
  for (const match of source.matchAll(pattern)) {
    try {
      const url = new URL(match[1], baseUrl);
      if (
        url.protocol === 'https:'
        && url.hostname === 'ledprojector.com.ua'
        && url.pathname.startsWith('/image/cache/lightning/')
        && url.pathname.endsWith('.js')
      ) {
        urls.push(url.toString());
      }
    } catch {
      // Invalid and external script URLs are intentionally ignored.
    }
  }
  return Object.freeze([...new Set(urls)]);
}

export function inspectWidgetBundle({
  url,
  normalBody,
  bypassBody,
  targets = PRODUCTION_MONITOR_TARGETS,
} = {}) {
  const normal = toBuffer(normalBody);
  const bypass = toBuffer(bypassBody);
  const normalText = normal.toString('utf8');
  const bypassText = bypass.toString('utf8');
  const normalMarkers = targets.widgetMarkers.every((marker) => normalText.includes(marker));
  const bypassMarkers = targets.widgetMarkers.every((marker) => bypassText.includes(marker));
  if (!normalMarkers && !bypassMarkers) {
    return Object.freeze({
      url,
      status: 'NOT_WIDGET',
      bytes: Object.freeze({ normal: normal.length, bypass: bypass.length }),
      hashes: Object.freeze({ normal: sha256(normal), bypass: sha256(bypass) }),
      markers: Object.freeze({ normal: false, bypass: false }),
      violations: Object.freeze([]),
    });
  }
  const violations = [];
  if (bypass.length < targets.widgetBundleMinBytes || !bypassMarkers) {
    violations.push('WIDGET_BUNDLE_INVALID');
  }
  if (
    normal.length !== bypass.length
    || sha256(normal) !== sha256(bypass)
    || normal.length < targets.widgetBundleMinBytes
    || !normalMarkers
  ) {
    violations.push('IMMUTABLE_BUNDLE_MISMATCH');
  }
  return Object.freeze({
    url,
    status: violations.length ? 'FAIL' : 'PASS',
    bytes: Object.freeze({ normal: normal.length, bypass: bypass.length }),
    hashes: Object.freeze({ normal: sha256(normal), bypass: sha256(bypass) }),
    markers: Object.freeze({ normal: normalMarkers, bypass: bypassMarkers }),
    violations: Object.freeze(violations),
  });
}

export function assessProductionMonitor({
  routeReports = [],
  bundleReports = [],
  browserReport = null,
  targets = PRODUCTION_MONITOR_TARGETS,
  checkedAt = new Date().toISOString(),
} = {}) {
  const violations = [];
  if (routeReports.length !== PRODUCTION_WIDGET_ROUTES.length) {
    violations.push('ROUTE_COVERAGE_INCOMPLETE');
  }
  for (const route of routeReports) {
    if (route.status !== 'PASS') violations.push(`ROUTE:${route.route}`);
  }
  const widgetBundles = bundleReports.filter((item) => item.markers?.bypass);
  if (widgetBundles.length !== 1) violations.push('WIDGET_BUNDLE_AMBIGUOUS');
  for (const bundle of widgetBundles) {
    violations.push(...bundle.violations);
  }

  if (!browserReport) {
    violations.push('BROWSER_PROBE_REQUIRED');
  } else {
    if (browserReport.status !== 'PASS') violations.push('BROWSER_PROBE_FAILED');
    if (browserReport.routes?.length !== PRODUCTION_WIDGET_ROUTES.length) {
      violations.push('BROWSER_ROUTE_COVERAGE_INCOMPLETE');
    }
    if (!browserReport.mobile?.mounted) violations.push('MOBILE_WIDGET_NOT_MOUNTED');
    const vitals = browserReport.mobile?.webVitals || {};
    if (!Number.isFinite(vitals.lcpMs) || vitals.lcpMs <= 0 || vitals.lcpMs > targets.webVitals.lcpMs) {
      violations.push('LCP');
    }
    if (!Number.isFinite(vitals.cls) || vitals.cls > targets.webVitals.cls) violations.push('CLS');
    if (!Number.isFinite(vitals.inpMs) || vitals.inpMs > targets.webVitals.inpMs) violations.push('INP');
    if (browserReport.errors?.length) violations.push('BROWSER_ERRORS');
  }

  const uniqueViolations = [...new Set(violations)];
  return Object.freeze({
    status: uniqueViolations.length ? 'FAIL' : 'PASS',
    checkedAt,
    routes: Object.freeze(routeReports),
    bundles: Object.freeze(bundleReports),
    browser: browserReport,
    targets,
    violations: Object.freeze(uniqueViolations),
    consequence: uniqueViolations.length
      ? 'FREEZE_ROLLOUT_AND_USE_ROLLBACK_RUNBOOK'
      : 'CONTINUE_MONITORING',
  });
}

export async function runProductionMonitor({
  fetchImpl = globalThis.fetch,
  browserProbe,
  baseUrl = PRODUCTION_MONITOR_TARGETS.baseUrl,
  routes = PRODUCTION_WIDGET_ROUTES,
  timeoutMs = 30_000,
  now = () => new Date(),
} = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl is required');
  const checkedAt = now().toISOString();
  const base = validateBaseUrl(baseUrl);
  const routeReports = await Promise.all(routes.map(async (route) => {
    const url = new URL(route, base);
    try {
      const response = await fetchWithTimeout(fetchImpl, url, timeoutMs);
      const html = await response.text();
      const scripts = extractLightningScriptUrls(html, base);
      const finalUrl = new URL(response.url || url, base);
      const validFinalHost = finalUrl.hostname === base.hostname;
      return Object.freeze({
        route,
        url: url.toString(),
        finalUrl: finalUrl.toString(),
        status: response.ok && validFinalHost && scripts.length > 0 ? 'PASS' : 'FAIL',
        httpStatus: response.status,
        lightningScripts: scripts,
      });
    } catch (error) {
      return Object.freeze({
        route,
        url: url.toString(),
        status: 'FAIL',
        httpStatus: null,
        lightningScripts: Object.freeze([]),
        error: normalizeError(error),
      });
    }
  }));

  const scriptUrls = [...new Set(routeReports.flatMap((item) => item.lightningScripts || []))];
  const bundleReports = await Promise.all(scriptUrls.map(async (url) => {
    try {
      const normalUrl = new URL(url);
      const bypassUrl = new URL(url);
      bypassUrl.searchParams.set('ai_advisor_integrity', String(now().getTime()));
      const [normalResponse, bypassResponse] = await Promise.all([
        fetchWithTimeout(fetchImpl, normalUrl, timeoutMs),
        fetchWithTimeout(fetchImpl, bypassUrl, timeoutMs),
      ]);
      const [normalBody, bypassBody] = await Promise.all([
        normalResponse.arrayBuffer(),
        bypassResponse.arrayBuffer(),
      ]);
      if (!normalResponse.ok || !bypassResponse.ok) {
        return Object.freeze({
          url,
          status: 'FAIL',
          markers: Object.freeze({ normal: false, bypass: false }),
          violations: Object.freeze(['WIDGET_BUNDLE_HTTP_FAILURE']),
        });
      }
      return inspectWidgetBundle({ url, normalBody, bypassBody });
    } catch (error) {
      return Object.freeze({
        url,
        status: 'FAIL',
        markers: Object.freeze({ normal: false, bypass: false }),
        violations: Object.freeze(['WIDGET_BUNDLE_FETCH_FAILURE']),
        error: normalizeError(error),
      });
    }
  }));

  const browserReport = typeof browserProbe === 'function'
    ? await browserProbe({ baseUrl: base.toString(), routes, timeoutMs })
    : null;
  return assessProductionMonitor({
    routeReports,
    bundleReports,
    browserReport,
    checkedAt,
  });
}

function validateBaseUrl(value) {
  const url = new URL(value);
  if (
    url.protocol !== 'https:'
    || url.hostname !== 'ledprojector.com.ua'
    || url.username
    || url.password
    || url.port
  ) {
    throw new Error('Production monitor base URL must be https://ledprojector.com.ua');
  }
  return url;
}

async function fetchWithTimeout(fetchImpl, url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    return await fetchImpl(url, {
      redirect: 'follow',
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        'cache-control': 'no-cache',
        'user-agent': 'AI-Advisor-Production-Monitor/1.0',
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function toBuffer(value) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  return Buffer.from(String(value || ''), 'utf8');
}

function normalizeError(error) {
  if (error?.name === 'AbortError') return 'TIMEOUT';
  return 'UNAVAILABLE';
}
