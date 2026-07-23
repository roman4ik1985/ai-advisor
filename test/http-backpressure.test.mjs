import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { readFile, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

test('test-only provider proves HTTP queue backpressure without OpenAI', async (context) => {
  const port = await getAvailablePort();
  const projectRoot = fileURLToPath(new URL('..', import.meta.url));
  const learningLogFile = `test-learning-${randomUUID()}.log`;
  const learningLogPath = join(projectRoot, 'logs', learningLogFile);
  const child = spawn(process.execPath, ['server.mjs', '--provider=test'], {
    cwd: new URL('..', import.meta.url),
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PORT: String(port),
      AI_MAX_CONCURRENT: '1',
      AI_MAX_QUEUE: '1',
      AI_TEST_PROVIDER_DELAY_MS: '250',
      RATE_LIMIT_PER_MINUTE: '20',
      LEARNING_LOG_ENABLED: 'true',
      LEARNING_LOG_FILE: learningLogFile,
    },
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true,
  });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  context.after(async () => {
    if (child.exitCode === null) child.kill();
    await rm(learningLogPath, { force: true });
  });

  await waitUntilReady(port, child, () => stderr);
  const responses = await Promise.all(Array.from({ length: 3 }, () => fetch(`http://127.0.0.1:${port}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'test queue' }] }),
  })));

  assert.deepEqual(responses.map((response) => response.status).sort((a, b) => a - b), [200, 200, 503]);
  const rejected = responses.find((response) => response.status === 503);
  assert.ok(rejected);
  assert.equal(rejected.headers.get('retry-after'), '1');
  const error = await rejected.json();
  assert.deepEqual(Object.keys(error).sort(), ['code', 'error', 'requestId']);
  assert.equal(error.code, 'AI_QUEUE_FULL');
  assert.equal(rejected.headers.get('x-request-id'), error.requestId);

  const successful = await Promise.all(responses.filter((response) => response.status === 200).map((response) => response.json()));
  assert.equal(successful.length, 2);
  assert.ok(successful.every((payload) => payload.provider === 'test' && payload.answer === 'Test-only AI response.'));
  const learningRecords = (await readFile(learningLogPath, 'utf8')).trim().split(/\r?\n/u).map((line) => JSON.parse(line));
  assert.equal(learningRecords.length, 2);
  assert.ok(learningRecords.every((record) => record.type === 'ai-advisor-learning-record'));
  assert.ok(learningRecords.every((record) => record.candidate?.reason === 'no-knowledge-match'));
  assert.equal((await fetch(`http://127.0.0.1:${port}/health`)).status, 200);
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
    if (child.exitCode !== null) throw new Error(`Test server exited early (${child.exitCode}): ${getStderr()}`);
    try {
      if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) return;
    } catch {
      // The isolated test server may still be binding the loopback port.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Test server did not become ready: ${getStderr()}`);
}
