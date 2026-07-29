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

test('widget renders catalog through DOM APIs and keeps product navigation user initiated', async () => {
  const source = await readFile(new URL('../public/widget.js', import.meta.url), 'utf8');

  assert.match(source, /function addProductCards\(rawCatalog, afterElement\)/);
  assert.match(source, /document\.createElement\('article'\)/);
  assert.match(source, /titleLink\.textContent = product\.name/);
  assert.match(source, /if \(selected\.length === 3\) break/);
  assert.match(source, /action\.addEventListener\('click'/);
  assert.match(source, /target\.scrollIntoView\(/);
  assert.doesNotMatch(source, /scheduleWalk/);
});

test('widget keeps accessibility, safe errors, and motion guards for product guidance', async () => {
  const [source, css] = await Promise.all([
    readFile(new URL('../public/widget.js', import.meta.url), 'utf8'),
    readFile(new URL('../public/widget.css', import.meta.url), 'utf8'),
  ]);

  assert.match(source, /aria-controls="\$\{panelId\}"/);
  assert.match(source, /panel\.setAttribute\('aria-modal', 'false'\)/);
  assert.match(source, /copy\[kind\]/);
  assert.doesNotMatch(source, /pending\.textContent = error\.message/);
  assert.match(source, /innerWidth >= 700/);
  assert.match(source, /prefers-reduced-motion: reduce/);
  assert.match(source, /guideTimer = setTimeout\(resetGuide, 8000\)/);
  assert.match(css, /\.lp-agent-product-highlight/);
  assert.match(css, /\.lp-agent-status \{[^}]*color: #fff/s);
  assert.match(css, /#0e7490/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});
