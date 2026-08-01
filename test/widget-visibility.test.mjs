import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import test from 'node:test';

const ROOT = new URL('..', import.meta.url);

test('widget visibility config defaults to enabled and is checked before mount', async () => {
  const [configText, widgetSource] = await Promise.all([
    readFile(new URL('../public/widget-config.json', import.meta.url), 'utf8'),
    readFile(new URL('../public/widget.js', import.meta.url), 'utf8'),
  ]);

  assert.deepEqual(JSON.parse(configText), { enabled: true });
  assert.match(widgetSource, /widgetConfigEndpoint = new URL\('\/widget-config\.json'/u);
  assert.match(widgetSource, /if \(!await readWidgetVisibility\(widgetConfigEndpoint\)\) return;/u);
  assert.match(widgetSource, /config\?\.enabled !== false/u);
  assert.match(widgetSource, /cache: 'no-store'/u);
});

test('visibility reader hides only on an explicit boolean false and otherwise fails visible', async () => {
  const source = await readFile(new URL('../public/widget.js', import.meta.url), 'utf8');
  const window = { __ledProjectorAgentTestOnly: true };
  vm.runInNewContext(source, {
    AbortController,
    URL,
    clearTimeout,
    fetch: async () => ({ ok: true, json: async () => ({ enabled: false }) }),
    setTimeout,
    window,
  }, { filename: 'public/widget.js' });

  assert.equal(await window.__ledProjectorAgentTestHooks.readWidgetVisibility('https://example.test/config'), false);

  const failureWindow = { __ledProjectorAgentTestOnly: true };
  vm.runInNewContext(source, {
    AbortController,
    URL,
    clearTimeout,
    fetch: async () => { throw new Error('offline'); },
    setTimeout,
    window: failureWindow,
  }, { filename: 'public/widget.js' });

  assert.equal(await failureWindow.__ledProjectorAgentTestHooks.readWidgetVisibility('https://example.test/config'), true);
});

test('visibility command writes only a boolean config value', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'ai-advisor-widget-visibility-'));
  const configPath = join(directory, 'widget-config.json');
  context.after(() => rm(directory, { recursive: true, force: true }));

  for (const [enabled, expected] of [['false', false], ['true', true]]) {
    const result = spawnSync('pwsh', [
      '-NoProfile',
      '-File',
      fileURLToPath(new URL('../scripts/set-widget-visibility.ps1', import.meta.url)),
      '-Enabled',
      enabled,
      '-ConfigPath',
      configPath,
    ], { encoding: 'utf8', windowsHide: true });

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(await readFile(configPath, 'utf8')), { enabled: expected });
  }
});

test('widget config is a public no-store boolean readable without credentials', async (context) => {
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

  const allowed = await fetch(`http://127.0.0.1:${port}/widget-config.json`, {
    headers: { Origin: allowedOrigin },
  });
  assert.equal(allowed.status, 200);
  assert.deepEqual(await allowed.json(), { enabled: true });
  assert.equal(allowed.headers.get('access-control-allow-origin'), '*');
  assert.equal(allowed.headers.get('cache-control'), 'no-store');
  assert.match(allowed.headers.get('content-type') || '', /^application\/json/u);

  const otherOrigin = await fetch(`http://127.0.0.1:${port}/widget-config.json`, {
    headers: { Origin: 'https://evil.example' },
  });
  assert.equal(otherOrigin.status, 200);
  assert.deepEqual(await otherOrigin.json(), { enabled: true });
  assert.equal(otherOrigin.headers.get('access-control-allow-origin'), '*');
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
  for (let attempt = 0; attempt < 50; attempt += 1) {
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
