import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const scriptUrl = new URL('../scripts/start-cli-test-browser.ps1', import.meta.url);

test('CLI browser launcher keeps local, staging, and production boundaries explicit', async () => {
  const script = await readFile(scriptUrl, 'utf8');

  assert.match(script, /http:\/\/127\.0\.0\.1:\$Port\//);
  assert.match(script, /--provider=cli/);
  assert.match(script, /https:\/\/ai-staging\.ledprojector\.com\.ua\//);
  assert.match(script, /https:\/\/ledprojector\.com\.ua\/dev\//);
  assert.match(script, /ProductionTouched = \$false/);
  assert.doesNotMatch(script, /8788/);
  assert.doesNotMatch(script, /AI Advisor API Host/);
});
