import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const libraryUrl = new URL('../scripts/system-secret-store.ps1', import.meta.url);
const provisioningUrl = new URL('../scripts/set-system-secret-store.ps1', import.meta.url);
const launcherUrl = new URL('../scripts/run-api-task.ps1', import.meta.url);

test('SYSTEM launcher removes env-file loading and injects only an allowlisted child environment', async () => {
  const [library, provisioning, launcher] = await Promise.all([
    readFile(libraryUrl, 'utf8'),
    readFile(provisioningUrl, 'utf8'),
    readFile(launcherUrl, 'utf8'),
  ]);

  assert.doesNotMatch(launcher, /--env-file|['"]\.env(?:['"]|\b)/iu);
  assert.match(launcher, /Read-SystemSecretStore/);
  assert.match(launcher, /-RequireSystemIdentity/);
  assert.match(launcher, /EnvironmentVariables\.Clear/);
  assert.match(launcher, /Get-SystemSecretChildEnvironmentNames/);
  assert.match(launcher, /EnvironmentVariables\[\[string\]\$name\]/);
  assert.doesNotMatch(launcher, /\$env:/iu);
  assert.match(library, /DataProtectionScope\]::LocalMachine/);
  assert.match(library, /AreAccessRulesProtected/);
  assert.match(library, /S-1-5-18/);
  assert.match(library, /S-1-5-32-544/);
  assert.match(
    library,
    /if \(-not \$Directory\) \{\s*Assert-SystemSecretStoreAcl -Path \(Split-Path -Parent \$Path\)\s*\}/u,
  );
  assert.match(library, /SYSTEM_SECRET_TELEGRAM_ACTIVATION_NOT_ALLOWED/);
  assert.doesNotMatch(library, /TELEGRAM_ORDER_MANAGER_CHAT_ID|REQUEST_MANAGER|managerChatId/iu);
  assert.doesNotMatch(library.match(/SystemSecretChildEnvironmentNames\s*=\s*@\(([\s\S]*?)\n\)/u)?.[1] || '', /NODE_OPTIONS/iu);
  assert.match(provisioning, /Read-Host[^\n]+-AsSecureString/);
  assert.doesNotMatch(provisioning, /SetEnvironmentVariable|\.env/iu);
});

test('PostHog pilot values and staging task isolation are explicitly supported', async () => {
  const [library, provisioning, launcher, installer] = await Promise.all([
    readFile(libraryUrl, 'utf8'),
    readFile(provisioningUrl, 'utf8'),
    readFile(launcherUrl, 'utf8'),
    readFile(new URL('../scripts/install-local-host-tasks.ps1', import.meta.url), 'utf8'),
  ]);
  for (const name of [
    'AI_ADVISOR_ANALYTICS_ENABLED', 'AI_ADVISOR_ANALYTICS_PROVIDER',
    'AI_ADVISOR_ANALYTICS_ENVIRONMENT', 'POSTHOG_PROJECT_TOKEN',
    'POSTHOG_API_HOST', 'AI_ADVISOR_ANALYTICS_PILOT_START',
    'AI_ADVISOR_ANALYTICS_PILOT_END', 'AI_ADVISOR_ANALYTICS_SCHEMA_VERSION',
    'AI_ADVISOR_WIDGET_VERSION',
  ]) assert.match(library, new RegExp(`'${name}'`));
  assert.doesNotMatch(library, /POSTHOG_PERSONAL_API_KEY/);
  assert.match(launcher, /\[string\]\$SecretStorePath/);
  assert.match(installer, /\[string\]\$InstanceName = 'AI Advisor'/);
  assert.match(installer, /-SecretStorePath/);
  assert.match(provisioning, /\[string\]\$Path/);
});

test('SYSTEM launcher fails closed under an ordinary user without reading the store', {
  skip: process.platform !== 'win32',
}, () => {
  const result = spawnSync('powershell.exe', [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    fileURLToPath(launcherUrl),
    '-Port',
    '65534',
  ], { encoding: 'utf8' });

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /SYSTEM_SECRET_LOAD_FAILED/);
});

test('DPAPI machine payload round-trips without plaintext persistence and rejects injection names', {
  skip: process.platform !== 'win32',
}, () => {
  const libraryPath = fileURLToPath(libraryUrl).replaceAll("'", "''");
  const command = [
    `$ErrorActionPreference = 'Stop'`,
    `. '${libraryPath}'`,
    `$values = @{ AI_PROVIDER = 'api'; HOST = '127.0.0.1'; ALLOWED_ORIGINS = 'https://ledprojector.com.ua,https://www.ledprojector.com.ua'; OPENAI_API_KEY = 'fake-openai-secret'; STORE_URL = 'https://ledprojector.com.ua'; SALESDRIVE_SUBDOMAIN = 'example-store'; SALESDRIVE_API_KEY = 'fake-salesdrive-secret'; SALESDRIVE_YML_URL = 'https://example-store.salesdrive.me/export/yml'; TELEGRAM_ORDER_ENABLED = 'false'; TELEGRAM_ORDER_WEBHOOK_SECRET = 'fake-webhook-secret' }`,
    `$envelope = Protect-SystemSecretPayload -Values $values -RequireRuntimeValues`,
    `$decoded = Unprotect-SystemSecretPayload -EnvelopeJson $envelope -RequireRuntimeValues`,
    `$injectionCode = $null`,
    `try { Protect-SystemSecretPayload -Values @{ NODE_OPTIONS = '--require=evil.js' } } catch { $injectionCode = $_.Exception.Message }`,
    `[pscustomobject]@{ envelope = $envelope; openAi = $decoded.OPENAI_API_KEY; webhook = $decoded.TELEGRAM_ORDER_WEBHOOK_SECRET; injectionCode = $injectionCode } | ConvertTo-Json -Compress`,
  ].join('; ');
  const encodedCommand = Buffer.from(command, 'utf16le').toString('base64');
  const result = spawnSync('powershell.exe', [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-EncodedCommand',
    encodedCommand,
  ], { encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout.trim());
  assert.equal(payload.openAi, 'fake-openai-secret');
  assert.equal(payload.webhook, 'fake-webhook-secret');
  assert.equal(payload.injectionCode, 'SYSTEM_SECRET_NAME_NOT_ALLOWED');
  assert.doesNotMatch(payload.envelope, /fake-openai-secret|fake-webhook-secret/);
  assert.match(payload.envelope, /DPAPI-LocalMachine/);
});

test('disabled Telegram is the default loader gate', {
  skip: process.platform !== 'win32',
}, () => {
  const libraryPath = fileURLToPath(libraryUrl).replaceAll("'", "''");
  const command = [
    `$ErrorActionPreference = 'Stop'`,
    `. '${libraryPath}'`,
    `$code = $null`,
    `try { Protect-SystemSecretPayload -Values @{ AI_PROVIDER = 'api'; HOST = '127.0.0.1'; ALLOWED_ORIGINS = 'https://ledprojector.com.ua,https://www.ledprojector.com.ua'; OPENAI_API_KEY = 'fake'; STORE_URL = 'https://ledprojector.com.ua'; SALESDRIVE_SUBDOMAIN = 'example-store'; SALESDRIVE_API_KEY = 'fake'; SALESDRIVE_YML_URL = 'https://example-store.salesdrive.me/export/yml'; TELEGRAM_ORDER_ENABLED = 'true' } -RequireRuntimeValues } catch { $code = $_.Exception.Message }`,
    `$code`,
  ].join('; ');
  const result = spawnSync('powershell.exe', [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64'),
  ], { encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.stdout.trim(), 'SYSTEM_SECRET_TELEGRAM_ACTIVATION_NOT_ALLOWED');
});

test('production bundle contract rejects missing live integration configuration', {
  skip: process.platform !== 'win32',
}, () => {
  const libraryPath = fileURLToPath(libraryUrl).replaceAll("'", "''");
  const command = [
    `$ErrorActionPreference = 'Stop'`,
    `. '${libraryPath}'`,
    `$code = $null`,
    `try { Protect-SystemSecretPayload -Values @{ AI_PROVIDER = 'api'; OPENAI_API_KEY = 'fake'; TELEGRAM_ORDER_ENABLED = 'false' } -RequireRuntimeValues } catch { $code = $_.Exception.Message }`,
    `$code`,
  ].join('; ');
  const result = spawnSync('powershell.exe', [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64'),
  ], { encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.stdout.trim(), 'SYSTEM_SECRET_REQUIRED_VALUE_MISSING');
});

test('release readiness returns only a stable code when the protected bundle is absent', {
  skip: process.platform !== 'win32',
}, () => {
  const libraryPath = fileURLToPath(libraryUrl).replaceAll("'", "''");
  const missingPath = 'C:\\Windows\\Temp\\ai-advisor-missing-system-secrets.dpapi';
  const command = [
    `$ErrorActionPreference = 'Stop'`,
    `. '${libraryPath}'`,
    `Test-SystemSecretStoreReleaseReadiness -Path '${missingPath}' | ConvertTo-Json -Compress`,
  ].join('; ');
  const result = spawnSync('powershell.exe', [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64'),
  ], { encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(JSON.parse(result.stdout.trim()), {
    Ready: false,
    Code: 'SYSTEM_SECRET_STORE_NOT_FOUND',
  });
});
