import test from 'node:test';
import assert from 'node:assert/strict';
import { extractPolicyFromPage, extractProductFromPage, parseProductUrlsFromSitemap } from '../scripts/collect-public-catalog-dry-run.mjs';

test('public catalog collector limits sitemap URLs to projector product pages', () => {
  const sitemap = `<?xml version="1.0"?><urlset><url><loc><![CDATA[https://ledprojector.com.ua/proektory/brand/model-a]]></loc></url><url><loc>https://ledprojector.com.ua/aksesuary/screen</loc></url><url><loc>https://ledprojector.com.ua/proektory/brand/model-b</loc></url></urlset>`;
  assert.deepEqual(parseProductUrlsFromSitemap(sitemap, 1), ['https://ledprojector.com.ua/proektory/brand/model-a']);
});

test('public collector extracts provenance and structured public product facts', () => {
  const html = `<html><head><meta property="og:image" content="/image/model.jpg"><script type="application/ld+json">{"@type":"Product","name":"SEO Demo Projector","sku":"DEMO-1","image":["/image/model.jpg"],"offers":{"price":"13999","priceCurrency":"UAH","availability":"https://schema.org/InStock"}}</script></head><body><h1>Demo Projector</h1><a class="thumbnail main-image" href="/image/model-large.jpg"></a><table><tr><td>Brightness</td><td>1500 ISO lumens</td></tr></table><div class="short-attribute"><span class="attr-name">Resolution</span><span class="attr-text">Full HD</span></div></body></html>`;
  const product = extractProductFromPage(html, 'https://ledprojector.com.ua/proektory/demo', '2026-07-29T00:00:00.000Z');
  assert.equal(product.sku, 'DEMO-1');
  assert.equal(product.name, 'Demo Projector');
  assert.equal(product.price.amount, '13999');
  assert.equal(product.price.currency, 'UAH');
  assert.equal(product.specifications.Brightness, '1500 ISO lumens');
  assert.equal(product.specifications.Resolution, 'Full HD');
  assert.equal(product.images.length, 2);
  assert.match(product.sourceHash, /^[a-f0-9]{64}$/u);
});

test('policy collector keeps source provenance with a bounded public summary', () => {
  const policy = extractPolicyFromPage('<html><head><meta name="description" content="Delivery policy"></head><body><main><h1>Delivery</h1><p>Delivery terms.</p></main></body></html>', 'https://ledprojector.com.ua/dostavka', '2026-07-29T00:00:00.000Z');
  assert.equal(policy.title, 'Delivery');
  assert.equal(policy.summary, 'Delivery policy');
  assert.match(policy.sourceHash, /^[a-f0-9]{64}$/u);
});
