import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { assessSecurityMaintenance, TRACKED_SECRET_MARKER_PATTERN } from '../security-maintenance.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const auditResult = spawnSync('npm.cmd', ['audit', '--json'], { cwd: root, encoding: 'utf8' });
let audit = {};
try { audit = JSON.parse(auditResult.stdout || '{}'); } catch { audit = {}; }
const grep = spawnSync('git.exe', [
  'grep', '-I', '-l', '-E',
  `(${TRACKED_SECRET_MARKER_PATTERN})`,
  '--', '.',
], { cwd: root, encoding: 'utf8' });
const secretFiles = grep.status === 0
  ? grep.stdout.split(/\r?\n/gu).map((item) => item.trim()).filter(Boolean)
  : [];
const server = await readFile(resolve(root, 'server.mjs'), 'utf8');
const headers = ['Content-Security-Policy', 'X-Content-Type-Options', 'Referrer-Policy']
  .filter((header) => server.includes(header));
const report = assessSecurityMaintenance({ audit, secretFiles, securityHeaders: headers });
console.log(JSON.stringify(report, null, 2));
if (report.status !== 'PASS') process.exitCode = 1;
