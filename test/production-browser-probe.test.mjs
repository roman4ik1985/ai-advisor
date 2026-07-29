import test from 'node:test';
import assert from 'node:assert/strict';
import { assessBrowserProbe, parseDevToolsEndpoint } from '../production-browser-probe.mjs';
import { PRODUCTION_WIDGET_ROUTES } from '../production-widget-monitor.mjs';

test('C61 parses only a real DevTools websocket endpoint', () => {
  assert.equal(
    parseDevToolsEndpoint('DevTools listening on ws://127.0.0.1:9222/devtools/browser/abc'),
    'ws://127.0.0.1:9222/devtools/browser/abc',
  );
  assert.equal(parseDevToolsEndpoint('ordinary browser stderr'), '');
});

test('C61 browser acceptance requires every route and mobile focus contract', () => {
  const pass = assessBrowserProbe({
    routes: PRODUCTION_WIDGET_ROUTES.map((route) => ({
      route,
      mounted: true,
      loaded: true,
      rootCount: 1,
    })),
    mobile: {
      mounted: true,
      interaction: { focusContract: true },
    },
    errors: [],
  });
  assert.equal(pass.status, 'PASS');

  const fail = assessBrowserProbe({
    routes: PRODUCTION_WIDGET_ROUTES.slice(0, 4).map((route) => ({
      route,
      mounted: true,
      loaded: true,
      rootCount: 1,
    })),
    mobile: {
      mounted: false,
      interaction: { focusContract: false },
    },
    errors: ['RUNTIME_EXCEPTION'],
  });
  assert.equal(fail.status, 'FAIL');
  assert.ok(fail.violations.includes('ROUTE_COVERAGE_INCOMPLETE'));
  assert.ok(fail.violations.includes('MOBILE_INTERACTION'));
  assert.ok(fail.violations.includes('BROWSER_ERRORS'));
});
