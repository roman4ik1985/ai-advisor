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
