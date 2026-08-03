import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const fromRoot = (...segments) => join(repositoryRoot, ...segments);
const logHelper = fromRoot('scripts', 'append-wiki-log.ps1');

const requiredDirectories = [
  ['raw', 'sources'],
  ['raw', 'web-clipped'],
  ['raw', 'assets'],
  ['wiki', 'entities'],
  ['wiki', 'concepts'],
  ['wiki', 'sources'],
  ['wiki', 'synthesis'],
];

const requiredFiles = [
  ['wiki', 'index.md'],
  ['wiki', 'log.md'],
  ['wiki', 'synthesis', 'handoffs', 'HANDOFF_TEMPLATE.md'],
  ['wiki', 'synthesis', 'specifications', 'TECHNICAL_SPECIFICATION.md'],
  ['wiki', 'synthesis', 'audits', 'AUDIT_REPORT_2026-07-20.md'],
  ['wiki', 'synthesis', 'runbooks', 'OPENCART_STAGING_EMBED.md'],
  ['raw', 'sources', 'agent-os', 'agent-os-ai-advisor-implementation.pdf'],
  ['raw', 'sources', 'agent-os', 'agent-os-ai-advisor-implementation-docs-copy.pdf'],
  ['raw', 'sources', 'agent-os', 'agent-os-test-plan.docx'],
];

const legacyRootFiles = [
  'PROJECT_LOG.md',
  'HANDOFF_TEMPLATE.md',
  'TECHNICAL_SPECIFICATION.md',
  'AUDIT_REPORT_2026-07-20.md',
  'OPENCART_STAGING_EMBED.md',
  'Внедрение Agent OS в AI Advisor.pdf',
  'agent-os.ps1',
];

const collectMarkdown = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collectMarkdown(path));
    else if (entry.name.endsWith('.md')) files.push(path);
  }
  return files;
};

test('shared raw and wiki structure is complete', async () => {
  for (const segments of requiredDirectories) {
    assert.equal((await stat(fromRoot(...segments))).isDirectory(), true, segments.join('/'));
  }
  for (const segments of requiredFiles) {
    assert.equal((await stat(fromRoot(...segments))).isFile(), true, segments.join('/'));
  }
});

test('legacy root documents and placeholders are absent', async () => {
  for (const name of legacyRootFiles) {
    await assert.rejects(access(fromRoot(name)), { code: 'ENOENT' });
  }

  const rootEntries = await readdir(repositoryRoot);
  assert.deepEqual(rootEntries.filter((name) => /^HANDOFF.*\.md$/u.test(name)), []);
  await assert.rejects(access(fromRoot('docs', 'agent-os.md')), { code: 'ENOENT' });
});

test('active documentation uses canonical wiki paths', async () => {
  const activeFiles = [
    fromRoot('AGENTS.md'),
    fromRoot('README.md'),
    ...await collectMarkdown(fromRoot('wiki', 'synthesis')),
  ];
  const forbidden = [
    /C:\\AI Advisor\\PROJECT_LOG\.md/u,
    /C:\\AI Advisor\\HANDOFF(?:_TEMPLATE|_[^\\\s`]+)\.md/u,
    /\]\(\.\/(?:TECHNICAL_SPECIFICATION|AUDIT_REPORT_2026-07-20|OPENCART_STAGING_EMBED)\.md/iu,
  ];

  for (const path of activeFiles) {
    const content = await readFile(path, 'utf8');
    for (const pattern of forbidden) {
      assert.doesNotMatch(content, pattern, path);
    }
  }

  const agents = await readFile(fromRoot('AGENTS.md'), 'utf8');
  assert.match(agents, /wiki\/log\.md/u);
  assert.match(agents, /wiki\/synthesis\/handoffs\/HANDOFF_TEMPLATE\.md/u);
  assert.match(agents, /raw\/sources\//u);
  assert.match(agents, /Obsidian/u);
});

test('relative Markdown links resolve after the structural move', async () => {
  const activeFiles = [
    fromRoot('README.md'),
    fromRoot('wiki', 'index.md'),
    ...await collectMarkdown(fromRoot('wiki', 'synthesis')),
  ];
  const failures = [];

  for (const path of activeFiles) {
    const content = await readFile(path, 'utf8');
    for (const match of content.matchAll(/\[[^\]]+\]\(([^)]+)\)/gu)) {
      const target = match[1].trim().replace(/^<|>$/gu, '');
      if (/^(?:https?:|mailto:|#)/iu.test(target)) continue;
      const fileTarget = decodeURIComponent(target.split('#', 1)[0]);
      if (!fileTarget) continue;
      try {
        await access(join(path, '..', fileTarget));
      } catch {
        failures.push(`${path}: ${target}`);
      }
    }
  }

  assert.deepEqual(failures, []);
});

test('canonical logger writes one UTF-8 LF record to an explicit log', {
  skip: process.platform !== 'win32',
}, async (t) => {
  const fixture = await mkdtemp(join(tmpdir(), 'ai-advisor-wiki-log-'));
  const logPath = join(fixture, 'log.md');
  await writeFile(logPath, '# Log\n', 'utf8');
  t.after(() => rm(fixture, { recursive: true, force: true }));

  const result = spawnSync('powershell.exe', [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    logHelper,
    '-Type',
    'query',
    '-Files',
    'test/project-structure.test.mjs',
    '-Summary',
    'structure logger contract',
    '-LogPath',
    logPath,
  ], { encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const bytes = await readFile(logPath);
  assert.notDeepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  const content = bytes.toString('utf8');
  assert.doesNotMatch(content, /\r/u);
  assert.match(
    content,
    /- \[\d{4}-\d{2}-\d{2} \d{2}:\d{2}\] query - test\/project-structure\.test\.mjs - structure logger contract\n$/u,
  );
});

test('backup and restore use the canonical logger and wiki log', async () => {
  const [helper, backup, restore] = await Promise.all([
    readFile(logHelper, 'utf8'),
    readFile(fromRoot('scripts', 'backup-project.ps1'), 'utf8'),
    readFile(fromRoot('scripts', 'restore-project.ps1'), 'utf8'),
  ]);

  assert.match(helper, /Join-Path \(Split-Path -Parent \$PSScriptRoot\) 'wiki\\log\.md'/u);
  for (const script of [backup, restore]) {
    assert.match(script, /append-wiki-log\.ps1/u);
    assert.match(script, /wiki\\log\.md/u);
    assert.doesNotMatch(script, /PROJECT_LOG\.md|function Add-ProjectLog/u);
  }
});
