import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';

test('HTTP errors use the standard contract and 429 includes Retry-After', async (context) => {
  const port = await getAvailablePort();
  const child = spawn(process.execPath, ['server.mjs', '--provider=api'], {
    cwd: new URL('..', import.meta.url),
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      OPENAI_API_KEY: 'local-contract-test-only',
      RATE_LIMIT_PER_MINUTE: '1',
      AI_MAX_CONCURRENT: '1',
      AI_MAX_QUEUE: '0',
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

  const forbidden = await fetch(`http://127.0.0.1:${port}/api/chat`, {
    method: 'OPTIONS',
    headers: { Origin: 'https://evil.example' },
  });
  await assertErrorResponse(forbidden, 403, 'ORIGIN_NOT_ALLOWED');

  const missing = await fetch(`http://127.0.0.1:${port}/missing`);
  await assertErrorResponse(missing, 404, 'NOT_FOUND');

  const unsupported = await fetch(`http://127.0.0.1:${port}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: 'x',
  });
  await assertErrorResponse(unsupported, 415, 'UNSUPPORTED_MEDIA_TYPE');

  const limited = await fetch(`http://127.0.0.1:${port}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [] }),
  });
  await assertErrorResponse(limited, 429, 'RATE_LIMITED');
  assert.match(limited.headers.get('retry-after') || '', /^\d+$/);
});

async function assertErrorResponse(response, expectedStatus, expectedCode) {
  assert.equal(response.status, expectedStatus);
  const payload = await response.json();
  assert.deepEqual(Object.keys(payload).sort(), ['code', 'error', 'requestId']);
  assert.equal(payload.code, expectedCode);
  assert.equal(typeof payload.error, 'string');
  assert.match(payload.requestId, /^[0-9a-f-]{36}$/);
  assert.equal(response.headers.get('x-request-id'), payload.requestId);
}

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
    if (child.exitCode !== null) {
      throw new Error(`Test server exited early (${child.exitCode}): ${getStderr()}`);
    }
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
