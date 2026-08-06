import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

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

  assert.match(source, /function addProductCards\(rawCatalog, afterElement, attempt\)/);
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

test('widget offers a dedicated Telegram order verification flow outside AI chat', async () => {
  const source = await readFile(new URL('../public/widget.js', import.meta.url), 'utf8');
  assert.match(source, /orderLinkEndpoint/u);
  assert.match(source, /orderReference/u);
  assert.match(source, /Статус замовлення/u);
  assert.match(source, /safeTelegramLink/u);
  assert.doesNotMatch(source, /conversation\.push\(\{ role: 'user', content: orderReference/u);
});

test('widget exposes an accessible operator selector with isolated conversations', async () => {
  const [source, css] = await Promise.all([
    readFile(new URL('../public/widget.js', import.meta.url), 'utf8'),
    readFile(new URL('../public/widget.css', import.meta.url), 'utf8'),
  ]);

  assert.match(source, /operatorCatalogEndpoint = new URL\('\/api\/operators'/u);
  assert.match(source, /aria-haspopup="listbox"/u);
  assert.match(source, /aria-controls="lp-agent-operator-menu"/u);
  assert.match(source, /role="listbox"/u);
  assert.match(source, /role', 'option'/u);
  assert.match(source, /const sessions = new Map\(\)/u);
  assert.match(source, /body: JSON\.stringify\(\{ operatorId: activeOperator\.id/u);
  assert.match(source, /localStorage\.setItem\('lp-agent-operator-id'/u);
  assert.match(css, /\.lp-agent-operator-trigger:focus-visible/u);
  assert.match(css, /\.lp-agent-operator-menu\[hidden\]/u);
  assert.match(css, /@media \(max-width: 560px\)[\s\S]*\.lp-agent-operator-menu/u);
});

test('operator selector implements wrapping arrow, Home, and End navigation', async () => {
  const source = await readFile(new URL('../public/widget.js', import.meta.url), 'utf8');
  const window = { __ledProjectorAgentTestOnly: true };
  vm.runInNewContext(source, { window, URL }, { filename: 'public/widget.js' });
  const { nextOperatorOptionIndex } = window.__ledProjectorAgentTestHooks;

  assert.equal(nextOperatorOptionIndex(0, 2, 'ArrowDown'), 1);
  assert.equal(nextOperatorOptionIndex(1, 2, 'ArrowDown'), 0);
  assert.equal(nextOperatorOptionIndex(0, 2, 'ArrowUp'), 1);
  assert.equal(nextOperatorOptionIndex(1, 2, 'Home'), 0);
  assert.equal(nextOperatorOptionIndex(0, 2, 'End'), 1);
  assert.equal(nextOperatorOptionIndex(0, 2, 'Enter'), -1);
});
