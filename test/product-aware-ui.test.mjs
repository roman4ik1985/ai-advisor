import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

async function loadHooks() {
  const source = await readFile(new URL('../public/widget.js', import.meta.url), 'utf8');
  const window = { __ledProjectorAgentTestOnly: true };
  vm.runInNewContext(source, { window, URL }, { filename: 'public/widget.js' });
  return window.__ledProjectorAgentTestHooks;
}

function fakeElement(name) {
  return { name };
}

test('product card projection allows only official HTTPS URLs, deduplicates, and limits output to three', async () => {
  const { selectProducts } = await loadHooks();
  const selected = selectProducts([
    {
      id: '953',
      sku: 'WANBO-T6-MAX',
      name: 'Xiaomi Wanbo T6 Max',
      canonicalUrl: 'https://www.ledprojector.com.ua/proektory/wanbo-1/xiaomi-wanbo-t6-max?search=wanbo',
      images: ['https://ledprojector.com.ua/image/t6.jpg'],
      prices: ['13 599 грн.', '12 499 грн.'],
      availability: { state: 'IN_STOCK' },
    },
    {
      name: 'Duplicate',
      url: 'https://ledprojector.com.ua/proektory/wanbo-1/xiaomi-wanbo-t6-max?utm_source=test',
    },
    { name: 'Unsafe HTTP', url: 'http://ledprojector.com.ua/proektory/unsafe' },
    { name: 'Foreign', url: 'https://evil.example/product' },
    { name: 'CinemaLux', url: 'https://ledprojector.com.ua/proektory/cinemalux' },
    { name: 'YG270', url: 'https://ledprojector.com.ua/proektory/yg270' },
    { name: 'Fourth', url: 'https://ledprojector.com.ua/proektory/fourth' },
  ]);

  assert.equal(selected.length, 3);
  assert.deepEqual(
    Array.from(selected, (product) => product.name),
    ['Xiaomi Wanbo T6 Max', 'CinemaLux', 'YG270'],
  );
  assert.equal(selected[0].canonicalUrl, 'https://ledprojector.com.ua/proektory/wanbo-1/xiaomi-wanbo-t6-max');
  assert.equal(selected[0].image, 'https://ledprojector.com.ua/image/t6.jpg');
});

test('product projection drops unsafe images without dropping an otherwise safe product', async () => {
  const { normalizeProduct } = await loadHooks();
  const product = normalizeProduct({
    name: 'Safe product',
    url: 'https://ledprojector.com.ua/proektory/safe',
    image: 'https://images.evil.example/tracker.gif',
  });

  assert.equal(product.image, '');
  assert.equal(product.url, 'https://ledprojector.com.ua/proektory/safe');
  assert.equal(normalizeProduct({
    id: 'credential-url',
    name: 'Credential URL',
    canonicalUrl: 'https://user:password@ledprojector.com.ua/credential-url',
  }), null);
  assert.equal(normalizeProduct({
    id: 'custom-port',
    name: 'Custom Port',
    canonicalUrl: 'https://ledprojector.com.ua:444/custom-port',
  }), null);
});

test('DOM matcher is deterministic: canonical URL wins over conflicting id, then id, sku, exact alias', async () => {
  const { matchProductCandidate, normalizeProduct } = await loadHooks();
  const product = normalizeProduct({
    id: '953',
    sku: 'WANBO-T6-MAX',
    name: 'Xiaomi Wanbo T6 Max',
    aliases: ['Wanbo T6'],
    url: 'https://ledprojector.com.ua/proektory/wanbo-1/xiaomi-wanbo-t6-max',
  });
  const wrongId = fakeElement('wrong-id');
  const urlMatch = fakeElement('url-match');
  const candidates = [
    { element: wrongId, ids: ['953'], names: ['Different model'] },
    {
      element: urlMatch,
      ids: ['other'],
      urls: ['https://www.ledprojector.com.ua/proektory/wanbo-1/xiaomi-wanbo-t6-max?search=wanbo#details'],
    },
  ];

  assert.equal(matchProductCandidate(product, candidates), urlMatch);
  assert.equal(matchProductCandidate(product, [{ element: wrongId, names: ['Wanbo T6 Pro'] }]), null);
  assert.equal(matchProductCandidate(product, [{ element: wrongId, names: ['Wanbo T6'] }]), wrongId);
});

test('OpenCart category and detail fixtures expose stable matching evidence', async () => {
  const { matchProductCandidate, normalizeProduct } = await loadHooks();
  const [categoryHtml, detailHtml] = await Promise.all([
    readFile(new URL('./fixtures/opencart-category.html', import.meta.url), 'utf8'),
    readFile(new URL('./fixtures/opencart-product-detail.html', import.meta.url), 'utf8'),
  ]);
  const product = normalizeProduct({
    id: '953',
    sku: 'WANBO-T6-MAX',
    name: 'Xiaomi Wanbo T6 Max',
    url: 'https://ledprojector.com.ua/proektory/wanbo-1/xiaomi-wanbo-t6-max',
  });
  const categoryCard = fakeElement('category-card');
  const detailCard = fakeElement('detail-card');

  assert.match(categoryHtml, /class="product-layout product-grid/);
  assert.match(detailHtml, /class="product-info"/);
  assert.equal(matchProductCandidate(product, [{
    element: categoryCard,
    urls: [...categoryHtml.matchAll(/href="([^"]+)"/g)].map((match) => match[1]),
    ids: [...categoryHtml.matchAll(/data-product-id="([^"]+)"/g)].map((match) => match[1]),
    skus: [...categoryHtml.matchAll(/data-product-sku="([^"]+)"/g)].map((match) => match[1]),
    names: [...categoryHtml.matchAll(/class="product-name"[^>]*>\s*<a[^>]*>([^<]+)</g)].map((match) => match[1]),
  }]), categoryCard);
  assert.equal(matchProductCandidate(product, [{
    element: detailCard,
    detail: true,
    urls: ['https://ledprojector.com.ua/proektory/wanbo-1/xiaomi-wanbo-t6-max'],
    ids: [...detailHtml.matchAll(/data-product-id="([^"]+)"/g)].map((match) => match[1]),
    skus: [...detailHtml.matchAll(/itemprop="sku">([^<]+)</g)].map((match) => match[1]),
    names: [...detailHtml.matchAll(/itemprop="name">([^<]+)</g)].map((match) => match[1]),
  }]), detailCard);
});

test('mascot guide chooses a free bounded side and falls back when no safe position exists', async () => {
  const { chooseGuidePosition } = await loadHooks();
  const target = { left: 200, top: 120, right: 500, bottom: 420 };
  const rightSide = { left: 512, top: 222, right: 608, bottom: 318 };

  assert.deepEqual(
    { ...chooseGuidePosition(target, { width: 1000, height: 700 }) },
    { left: 512, top: 222 },
  );
  assert.deepEqual(
    { ...chooseGuidePosition(target, { width: 1000, height: 700 }, [rightSide]) },
    { left: 92, top: 222 },
  );
  assert.equal(chooseGuidePosition(target, { width: 699, height: 700 }), null);

  const blocked = [
    { left: 500, top: 0, right: 1000, bottom: 700 },
    { left: 0, top: 0, right: 200, bottom: 700 },
    { left: 0, top: 420, right: 1000, bottom: 700 },
    { left: 0, top: 0, right: 1000, bottom: 120 },
  ];
  assert.equal(chooseGuidePosition(target, { width: 1000, height: 700 }, blocked), null);
});

test('frontend error taxonomy never depends on backend error text', async () => {
  const { errorKind } = await loadHooks();

  assert.equal(errorKind({ name: 'AbortError', message: 'secret timeout detail' }), 'timeout');
  assert.equal(errorKind({ uiCode: 'RATE_LIMITED', message: 'raw 429' }), 'rateLimit');
  assert.equal(errorKind({ uiCode: 'UNAVAILABLE', message: 'raw stack' }), 'unavailable');
  assert.equal(errorKind({ message: 'Unexpected token <' }), 'error');
});
