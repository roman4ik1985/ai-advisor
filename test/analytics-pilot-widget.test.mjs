import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import test from 'node:test';
import vm from 'node:vm';

const ROOT = new URL('..', import.meta.url);

async function loadHooks() {
  const source = await readFile(new URL('../public/widget.js', import.meta.url), 'utf8');
  const window = { __ledProjectorAgentTestOnly: true };
  vm.runInNewContext(source, {
    AbortController,
    clearTimeout,
    setTimeout,
    Uint8Array,
    URL,
    window,
  }, { filename: 'public/widget.js' });
  return window.__ledProjectorAgentTestHooks;
}

function response(body, ok = true) {
  return {
    ok,
    async json() {
      return body;
    },
  };
}

test('widget pilot adapter buffers safely, exposes only specialized methods, and sends no user text', async () => {
  const { createWidgetAnalyticsAdapter } = await loadHooks();
  const requests = [];
  let clock = 1_000;
  let uuidCounter = 0;
  const ids = [
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
  ];
  const adapter = createWidgetAnalyticsAdapter({
    configUrl: 'https://ai.ledprojector.com.ua/api/analytics/config',
    eventUrl: 'https://ai.ledprojector.com.ua/api/analytics/event',
    locale: 'uk',
    pageType: 'product',
    trafficType: 'synthetic',
    now: () => clock,
    uuid: () => ids[uuidCounter++],
    fetchImpl: async (url, options = {}) => {
      requests.push({ url, options });
      if (url.endsWith('/config')) {
        return response({
          enabled: true,
          schemaVersion: '1',
          environment: 'staging',
          widgetVersion: '0.1.0',
        });
      }
      return response({ ok: true });
    },
  });

  const attempt = adapter.createInteraction({
    questionLength: 72,
    hasProductContext: true,
  });
  adapter.trackQuestionSubmitted(attempt);
  await adapter.initialized;
  clock = 2_250;
  adapter.trackAnswerCompleted(attempt, 2);
  adapter.trackAnswerFailed(attempt, {
    error_type: 'unknown',
    error_stage: 'unknown',
    retryable: false,
  });

  const eventBodies = requests
    .filter(({ url }) => url.endsWith('/event'))
    .map(({ options }) => JSON.parse(options.body));
  assert.deepEqual(eventBodies.map(({ event }) => event), ['question_submitted', 'answer_completed']);
  assert.equal(eventBodies[0].analyticsSessionId, ids[0]);
  assert.equal(eventBodies[0].properties.interaction_id, ids[1]);
  assert.equal(eventBodies[0].properties.question_length_bucket, '41_120');
  assert.equal(eventBodies[1].properties.response_time_ms, 1_250);
  assert.equal(eventBodies[1].properties.recommendation_count_bucket, '2');
  assert.equal(JSON.stringify(eventBodies).includes('question text'), false);
  assert.equal('track' in adapter, false);
});

test('widget pilot adapter is a no-op when public config is disabled or unavailable', async () => {
  const { createWidgetAnalyticsAdapter } = await loadHooks();
  const requests = [];
  const adapter = createWidgetAnalyticsAdapter({
    configUrl: 'https://ai.ledprojector.com.ua/api/analytics/config',
    eventUrl: 'https://ai.ledprojector.com.ua/api/analytics/event',
    locale: 'ru',
    pageType: 'home',
    trafficType: 'real',
    uuid: () => '11111111-1111-4111-8111-111111111111',
    fetchImpl: async (url) => {
      requests.push(url);
      return response({ enabled: false });
    },
  });

  adapter.trackWidgetShown();
  adapter.trackWidgetOpened();
  await adapter.initialized;
  adapter.trackWidgetOpened();

  assert.deepEqual(requests, ['https://ai.ledprojector.com.ua/api/analytics/config']);
});

test('page classification emits only a closed enum and never returns URL data', async () => {
  const { classifyPageType } = await loadHooks();

  assert.equal(classifyPageType({ href: 'https://ledprojector.com.ua/' }), 'home');
  assert.equal(
    classifyPageType({ href: 'https://ledprojector.com.ua/index.php?route=product/product&product_id=42#secret' }),
    'product',
  );
  assert.equal(
    classifyPageType({ href: 'https://ledprojector.com.ua/index.php?route=checkout/simplecheckout' }),
    'checkout',
  );
  assert.equal(classifyPageType({ href: 'not a URL' }), 'other');
});

test('disabled server pilot exposes token-free no-store config and rejects event ingestion', async (context) => {
  const port = await getAvailablePort();
  const allowedOrigin = 'https://ledprojector.com.ua';
  const child = spawn(process.execPath, ['server.mjs', '--provider=test'], {
    cwd: ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      HOST: '127.0.0.1',
      PORT: String(port),
      ALLOWED_ORIGINS: allowedOrigin,
      AI_ADVISOR_ANALYTICS_ENABLED: 'false',
    },
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true,
  });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  context.after(() => {
    if (child.exitCode === null) child.kill();
  });
  await waitUntilReady(port, child, () => stderr);

  const config = await fetch(`http://127.0.0.1:${port}/api/analytics/config`, {
    headers: { Origin: allowedOrigin },
  });
  assert.equal(config.status, 200);
  assert.equal(config.headers.get('cache-control'), 'no-store');
  const publicConfig = await config.json();
  assert.equal(publicConfig.enabled, false);
  assert.equal('token' in publicConfig, false);
  assert.equal(JSON.stringify(publicConfig).includes('POSTHOG'), false);

  const ingestion = await fetch(`http://127.0.0.1:${port}/api/analytics/event`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: allowedOrigin,
    },
    body: JSON.stringify({ event: 'widget_shown' }),
  });
  assert.equal(ingestion.status, 404);

  const health = await fetch(`http://127.0.0.1:${port}/health`);
  assert.equal(health.status, 200);
});

async function getAvailablePort() {
  const probe = createServer();
  await new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', resolve);
  });
  const { port } = probe.address();
  await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function waitUntilReady(port, child, getStderr) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Test server exited early: ${getStderr()}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) return;
    } catch {
      // The server may still be binding the port.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Test server did not become ready: ${getStderr()}`);
}
