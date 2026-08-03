import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const scriptUrls = [
  new URL('../scripts/backup-project.ps1', import.meta.url),
  new URL('../scripts/extract-backup-archive.ps1', import.meta.url),
  new URL('../scripts/restore-project.ps1', import.meta.url),
  new URL('../scripts/test-backup-restore.ps1', import.meta.url),
];

const runPowerShell = (args) => spawnSync('powershell.exe', [
  '-NoLogo',
  '-NoProfile',
  '-NonInteractive',
  '-ExecutionPolicy',
  'Bypass',
  ...args,
], { encoding: 'utf8' });

test('backup local-only artifacts are excluded from Git', async () => {
  const gitignore = await readFile(new URL('../.gitignore', import.meta.url), 'utf8');
  for (const entry of ['.backup-key.dpapi', '.backup-smoke/', '_backups/', '*.bak']) {
    assert.match(gitignore, new RegExp(`^${entry.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}$`, 'mu'));
  }
});

test('backup and restore scripts have valid PowerShell syntax', {
  skip: process.platform !== 'win32',
}, () => {
  const paths = scriptUrls.map((url) => `'${fileURLToPath(url).replaceAll("'", "''")}'`).join(',');
  const command = [
    `$ErrorActionPreference = 'Stop'`,
    `$errors = @()`,
    `foreach ($path in @(${paths})) {`,
    `  $tokens = $null`,
    `  $parseErrors = $null`,
    `  [void][System.Management.Automation.Language.Parser]::ParseFile($path, [ref]$tokens, [ref]$parseErrors)`,
    `  $errors += @($parseErrors)`,
    `}`,
    `if ($errors.Count -gt 0) { throw ($errors | Out-String) }`,
  ].join('; ');
  const result = runPowerShell(['-Command', command]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test('restore tools reject archive traversal and protected target roots before decryption', {
  skip: process.platform !== 'win32',
}, async (t) => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'ai-advisor-backup-contract-'));
  const driveRoot = join(fixtureRoot, 'drive');
  await writeFile(join(fixtureRoot, '.backup-key.dpapi'), 'not-a-real-key', 'utf8');
  t.after(() => rm(fixtureRoot, { recursive: true, force: true }));

  for (const scriptUrl of scriptUrls.slice(1, 3)) {
    const script = fileURLToPath(scriptUrl);
    const traversal = runPowerShell([
      '-File', script,
      '-ProjectRoot', fixtureRoot,
      '-DriveDirectory', driveRoot,
      '-TargetDirectory', join(tmpdir(), 'ai-advisor-safe-new-target'),
      '-ArchiveName', 'ai-advisor-20260803-010203/../../outside.7z',
    ]);
    assert.notEqual(traversal.status, 0);
    assert.match(`${traversal.stdout}\n${traversal.stderr}`, /ArchiveName must be a single file name/u);

    const protectedTarget = runPowerShell([
      '-File', script,
      '-ProjectRoot', fixtureRoot,
      '-DriveDirectory', driveRoot,
      '-TargetDirectory', join(fixtureRoot, 'restore'),
      '-ArchiveName', 'ai-advisor-20260803-010203.7z',
    ]);
    assert.notEqual(protectedTarget.status, 0);
    assert.match(`${protectedTarget.stdout}\n${protectedTarget.stderr}`, /outside protected project\/runtime root/u);
  }
});

test('backup retention refuses zero days before creating any archive', {
  skip: process.platform !== 'win32',
}, () => {
  const result = runPowerShell([
    '-File', fileURLToPath(scriptUrls[0]),
    '-RetentionDays', '0',
  ]);
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /RetentionDays/u);
});

test('backup refuses a drive destination inside the project before creating a key', {
  skip: process.platform !== 'win32',
}, async (t) => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'ai-advisor-backup-destination-'));
  t.after(() => rm(fixtureRoot, { recursive: true, force: true }));

  const result = runPowerShell([
    '-File', fileURLToPath(scriptUrls[0]),
    '-ProjectRoot', fixtureRoot,
    '-DriveDirectory', join(fixtureRoot, 'recursive-drive-copy'),
  ]);
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /outside ProjectRoot/u);

  await assert.rejects(readFile(join(fixtureRoot, '.backup-key.dpapi')), { code: 'ENOENT' });
});
