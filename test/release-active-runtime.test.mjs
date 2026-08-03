import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const scriptUrl = new URL('../scripts/release-active-runtime.ps1', import.meta.url);

test('P3P4 runtime release is exact, protected, and reversible', async () => {
  const script = await readFile(scriptUrl, 'utf8');
  const profileMatch = script.match(/P3P4Runtime\s*=\s*@\(([\s\S]*?)\n\s*\)/);
  assert.ok(profileMatch, 'P3P4Runtime profile must exist');

  const paths = [...profileMatch[1].matchAll(/'([^']+)'/g)].map((match) => match[1].replaceAll('\\', '/'));
  assert.deepEqual(paths, [
    'server.mjs',
    'live-resolvers.mjs',
    'product-specification-evidence.mjs',
    'product-analytics.mjs',
    'readiness-slo.mjs',
    'rate-limit-strategy.mjs',
    'request-pipeline.mjs',
    'public/widget.js',
    'knowledge/product-specifications.json',
  ]);

  assert.match(script, /protectedRuntimePaths\.Add\('public\\widget-config\.json'\)/);
  assert.match(script, /Backup hash verification failed/);
  assert.match(script, /Rollback hash verification failed/);
  assert.match(script, /RollbackFrom/);
  assert.doesNotMatch(profileMatch[1], /package(?:-lock)?\.json|README|TECHNICAL_SPECIFICATION|scripts|test/);
});

test('SYSTEM secret loader release is minimal and blocks apply behind a boolean-only readiness guard', async () => {
  const script = await readFile(scriptUrl, 'utf8');
  const profileMatch = script.match(/SYSTEMSecretLoader\s*=\s*@\(([\s\S]*?)\n\s*\)/);
  assert.ok(profileMatch, 'SYSTEMSecretLoader profile must exist');

  const paths = [...profileMatch[1].matchAll(/'([^']+)'/g)].map((match) => match[1].replaceAll('\\', '/'));
  assert.deepEqual(paths, [
    'scripts/run-api-task.ps1',
    'scripts/system-secret-store.ps1',
  ]);
  assert.match(script, /\[ValidateSet\('P3P4Runtime', 'SYSTEMSecretLoader', 'TelegramCustomerRuntime'\)\]/);
  assert.match(script, /Test-SystemSecretStoreReleaseReadiness/);
  assert.match(script, /SYSTEM_SECRET_RELEASE_BLOCKED/);
  assert.ok(
    script.indexOf("if (-not $Apply)") < script.indexOf("if ($Profile -eq 'SYSTEMSecretLoader')"),
    'dry-run must return before any protected-store readiness check',
  );
});

test('Telegram customer runtime release has the complete server-side import closure and no configuration or secret material', async () => {
  const script = await readFile(scriptUrl, 'utf8');
  const profileMatch = script.match(/TelegramCustomerRuntime\s*=\s*@\(([\s\S]*?)\n\s*\)/);
  assert.ok(profileMatch, 'TelegramCustomerRuntime profile must exist');

  const paths = [...profileMatch[1].matchAll(/'([^']+)'/g)].map((match) => match[1].replaceAll('\\', '/'));
  assert.deepEqual(paths, [
    'server.mjs',
    'telegram-order-runtime.mjs',
    'telegram-order-redis-client.mjs',
    'telegram-order-redis-store.mjs',
    'telegram-order-redis-rate-limit.mjs',
    'telegram-order-sender.mjs',
    'telegram-order-outbox.mjs',
    'telegram-order-action-sink.mjs',
    'telegram-order-webhook.mjs',
    'telegram-order-menu.mjs',
    'telegram-order-binding.mjs',
    'telegram-order-provisioning.mjs',
    'salesdrive-order-provisioning.mjs',
    'telegram-owned-order-service.mjs',
    'salesdrive-order-client.mjs',
    'order-ownership-contract.mjs',
    'order-dto.mjs',
  ]);
  assert.doesNotMatch(profileMatch[1], /\.env|secret|credential|package(?:-lock)?\.json|docs|test/i);
  assert.match(script, /'TelegramCustomerRuntime'\)\) \{/);
});
