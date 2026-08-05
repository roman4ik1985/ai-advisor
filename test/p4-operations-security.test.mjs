import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('P4 server and widget expose disabled-by-default privacy and readiness contracts', async () => {
  const [server, widget, analytics, pilot, envExample] = await Promise.all([
    readFile(new URL('../server.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../public/widget.js', import.meta.url), 'utf8'),
    readFile(new URL('../product-analytics.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../analytics-pilot.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../.env.example', import.meta.url), 'utf8'),
  ]);
  assert.match(server, /PRODUCT_ANALYTICS_ENABLED/u);
  assert.match(server, /requestUrl\.pathname === '\/ready'/u);
  assert.match(server, /BACKEND_INSTANCE_COUNT/u);
  assert.match(widget, /dataset\.productAnalytics === 'true'/u);
  assert.match(analytics, /retentionDays:\s*RETENTION_DAYS/u);
  assert.doesNotMatch(analytics, /requestId:|clientId:|userAgent:|remoteAddress:/u);
  assert.match(widget, /body: JSON\.stringify\(\{ eventType, productKey \}\)/u);
  assert.match(server, /requestUrl\.pathname === '\/api\/analytics\/config'/u);
  assert.match(server, /requestUrl\.pathname === '\/api\/analytics\/event'/u);
  assert.match(envExample, /AI_ADVISOR_ANALYTICS_ENABLED=false/u);
  assert.match(pilot, /\$process_person_profile:\s*false/u);
  assert.match(pilot, /disableGeoip:\s*true/u);
  assert.match(pilot, /before_send:/u);
  assert.doesNotMatch(widget, /posthog\.capture|\.identify\(|\.alias\(/u);
  assert.doesNotMatch(pilot, /\.identify\(|\.alias\(/u);
});
