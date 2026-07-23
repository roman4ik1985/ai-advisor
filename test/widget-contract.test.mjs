import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('widget keeps an absolute production endpoint when optimizers strip data-endpoint', async () => {
  const source = await readFile(new URL('../public/widget.js', import.meta.url), 'utf8');

  assert.match(
    source,
    /script\?\.dataset\.endpoint \|\| 'https:\/\/ai\.ledprojector\.com\.ua\/api\/chat'/,
  );
  assert.match(source, /AbortController\(\)/);
  assert.match(source, /signal: controller\.signal/);
  assert.match(source, /if \(busy\) return;/);
  assert.match(
    source,
    /script\?\.dataset\.mascot \|\| 'https:\/\/ai\.ledprojector\.com\.ua\/assets\/mascot\.png'/,
  );
});
