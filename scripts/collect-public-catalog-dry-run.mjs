import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE_ORIGIN = 'https://ledprojector.com.ua';
const PRODUCT_SITEMAP_URL = `${SITE_ORIGIN}/sitemap-product.xml`;
const POLICY_URLS = [
  `${SITE_ORIGIN}/oplata-1`,
  `${SITE_ORIGIN}/dostavka`,
  `${SITE_ORIGIN}/garantiya`,
  `${SITE_ORIGIN}/politika-obmena-i-vozvrata-tovara`,
];
const PROJECT_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DEFAULT_OUTPUT = resolve(PROJECT_ROOT, 'data', 'ai-advisor-public-catalog-dry-run.json');

export function parseProductUrlsFromSitemap(xml, limit = 10) {
  return [...String(xml || '').matchAll(/<loc><!\[CDATA\[(https:\/\/ledprojector\.com\.ua\/[^\]]+)\]\]><\/loc>|<loc>(https:\/\/ledprojector\.com\.ua\/[^<]+)<\/loc>/giu)]
    .map((match) => decodeEntities(match[1] || match[2] || '').trim())
    .filter((url) => url.includes('/proektory/'))
    .filter((url, index, values) => values.indexOf(url) === index)
    .slice(0, limit);
}

export function extractProductFromPage(html, sourceUrl, capturedAt) {
  const jsonLd = extractJsonLd(html);
  const product = jsonLd.find((item) => hasType(item, 'Product')) || {};
  const offers = firstObject(product.offers);
  const title = firstNonEmpty(
    getTagText(html, 'h1'),
    product.name,
    getMeta(html, 'property', 'og:title'),
    getTagText(html, 'title'),
  );
  const price = firstNonEmpty(
    offers.price,
    getMeta(html, 'itemprop', 'price'),
    extractVisiblePrice(html),
  );
  const imageUrls = unique([
    ...asArray(product.image),
    getMeta(html, 'property', 'og:image'),
    ...extractGalleryImageUrls(html),
  ].map((value) => normalizeUrl(value, sourceUrl)).filter(Boolean)).slice(0, 5);

  return {
    publicProductId: null,
    sku: normalizeText(product.sku) || null,
    name: normalizeText(title) || null,
    canonicalUrl: normalizeUrl(product.url, sourceUrl) || sourceUrl,
    images: imageUrls,
    price: price ? {
      amount: normalizePrice(price),
      currency: normalizeText(offers.priceCurrency) || inferCurrency(price) || null,
      source: 'public_product_page',
    } : null,
    publicAvailability: normalizeText(offers.availability) || null,
    description: normalizeText(product.description || getMeta(html, 'name', 'description')).slice(0, 1600) || null,
    specifications: extractSpecifications(html),
    sourceUrl,
    capturedAt,
    sourceHash: sha256(html),
  };
}

export function extractPolicyFromPage(html, sourceUrl, capturedAt) {
  return {
    title: normalizeText(firstNonEmpty(getMeta(html, 'property', 'og:title'), getTagText(html, 'h1'), getTagText(html, 'title'))) || null,
    summary: normalizeText(firstNonEmpty(getMeta(html, 'name', 'description'), extractMainText(html))).slice(0, 2400) || null,
    sourceUrl,
    capturedAt,
    sourceHash: sha256(html),
  };
}

export async function collectPublicCatalogDryRun({ fetchImpl = fetch, now = () => new Date(), limit = 10 } = {}) {
  const capturedAt = now().toISOString();
  const sitemapHtml = await fetchText(PRODUCT_SITEMAP_URL, fetchImpl);
  const productUrls = parseProductUrlsFromSitemap(sitemapHtml, limit);
  if (productUrls.length !== limit) throw new Error(`Expected ${limit} public projector URLs, found ${productUrls.length}.`);

  const products = [];
  for (const sourceUrl of productUrls) {
    const html = await fetchText(sourceUrl, fetchImpl);
    products.push(extractProductFromPage(html, sourceUrl, capturedAt));
  }

  const policies = [];
  for (const sourceUrl of POLICY_URLS) {
    const html = await fetchText(sourceUrl, fetchImpl);
    policies.push(extractPolicyFromPage(html, sourceUrl, capturedAt));
  }

  return {
    schemaVersion: '1.0',
    collection: {
      kind: 'public-catalog-dry-run',
      capturedAt,
      sourceSitemapUrl: PRODUCT_SITEMAP_URL,
      productCount: products.length,
      policyCount: policies.length,
      limitations: [
        'Public availability is not physical stock or reservable quantity.',
        'Public product pages do not prove delivery date or personal pricing.',
        'This raw dataset is not approved knowledge and must not be used for unsupported claims.',
      ],
    },
    products,
    policies,
  };
}

async function main() {
  const outputPath = process.argv[2] ? resolve(process.argv[2]) : DEFAULT_OUTPUT;
  const dataset = await collectPublicCatalogDryRun();
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(dataset, null, 2)}\n`, 'utf8');
  console.log(`Collected ${dataset.products.length} products and ${dataset.policies.length} policies: ${outputPath}`);
}

async function fetchText(url, fetchImpl) {
  const response = await fetchImpl(url, {
    headers: { 'User-Agent': 'LedProjector-AI-Advisor-public-catalog-dry-run/1.0' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Public source returned ${response.status}: ${url}`);
  return response.text();
}

function extractJsonLd(html) {
  const items = [];
  for (const match of String(html || '').matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/giu)) {
    try {
      const parsed = JSON.parse(match[1].trim());
      items.push(...flattenJsonLd(parsed));
    } catch {
      // Public markup may contain an invalid unrelated JSON-LD block.
    }
  }
  return items;
}

function flattenJsonLd(value) {
  if (Array.isArray(value)) return value.flatMap(flattenJsonLd);
  if (!value || typeof value !== 'object') return [];
  return [...asArray(value['@graph']).flatMap(flattenJsonLd), value];
}

function extractSpecifications(html) {
  const rows = [...String(html || '').matchAll(/<tr[^>]*>\s*<(?:th|td)[^>]*>([\s\S]*?)<\/(?:th|td)>\s*<(?:th|td)[^>]*>([\s\S]*?)<\/(?:th|td)>\s*<\/tr>/giu)];
  const values = {};
  for (const row of rows) {
    const key = normalizeText(stripTags(row[1]));
    const value = normalizeText(stripTags(row[2]));
    if (key && value && key.length <= 160 && value.length <= 800) values[key] = value;
  }
  for (const attribute of String(html || '').matchAll(/<div[^>]+class=["'][^"']*short-attribute[^"']*["'][^>]*>[\s\S]*?<span[^>]+class=["'][^"']*attr-name[^"']*["'][^>]*>([\s\S]*?)<\/span>[\s\S]*?<span[^>]+class=["'][^"']*attr-text[^"']*["'][^>]*>([\s\S]*?)<\/span>[\s\S]*?<\/div>/giu)) {
    const key = normalizeText(stripTags(attribute[1]));
    const value = normalizeText(stripTags(attribute[2]));
    if (key && value && key.length <= 160 && value.length <= 800) values[key] = value;
  }
  return values;
}

function extractGalleryImageUrls(html) {
  const urls = [];
  for (const anchor of String(html || '').matchAll(/<a[^>]+class=["'][^"']*(?:main-image|dop-img)[^"']*["'][^>]*>/giu)) {
    const href = anchor[0].match(/(?:data-magnify-src|href)=["']([^"']+)["']/iu)?.[1];
    if (href) urls.push(href);
  }
  return urls;
}

function extractMainText(html) {
  const main = String(html || '').match(/<(?:main|article)[^>]*>([\s\S]*?)<\/(?:main|article)>/iu)?.[1] || String(html || '');
  return stripTags(main);
}

function getMeta(html, attribute, expectedValue) {
  const pattern = new RegExp(`<meta[^>]+${attribute}=["']${escapeRegExp(expectedValue)}["'][^>]+content=["']([^"']*)["'][^>]*>|<meta[^>]+content=["']([^"']*)["'][^>]+${attribute}=["']${escapeRegExp(expectedValue)}["'][^>]*>`, 'iu');
  const match = String(html || '').match(pattern);
  return decodeEntities(match?.[1] || match?.[2] || '');
}

function getTagText(html, tag) {
  const match = String(html || '').match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'iu'));
  return decodeEntities(stripTags(match?.[1] || ''));
}

function extractVisiblePrice(html) {
  const match = String(html || '').match(/(?:price-new|price)[^>]*>([\s\S]{0,300}?(?:грн\.?|₴|UAH)[\s\S]{0,100}?)<\//iu);
  return normalizeText(stripTags(match?.[1] || ''));
}

function firstObject(value) {
  return asArray(value).find((item) => item && typeof item === 'object') || {};
}

function hasType(value, expected) {
  return asArray(value?.['@type']).some((item) => String(item).toLowerCase() === expected.toLowerCase());
}

function asArray(value) {
  return Array.isArray(value) ? value : value == null ? [] : [value];
}

function firstNonEmpty(...values) {
  return values.find((value) => normalizeText(value));
}

function normalizeUrl(value, baseUrl) {
  try {
    return new URL(String(value || ''), baseUrl).toString();
  } catch {
    return '';
  }
}

function normalizePrice(value) {
  const match = String(value || '').replace(/\s+/gu, ' ').match(/[\d\s]{2,}(?:[,.]\d{1,2})?/u);
  return match ? match[0].replace(/\s+/gu, '').replace(',', '.') : null;
}

function inferCurrency(value) {
  return /грн|₴/iu.test(String(value || '')) ? 'UAH' : /\bUAH\b/iu.test(String(value || '')) ? 'UAH' : null;
}

function normalizeText(value) {
  return decodeEntities(stripTags(String(value || ''))).replace(/\s+/gu, ' ').trim();
}

function stripTags(value) {
  return String(value || '').replace(/<[^>]*>/gu, ' ');
}

function decodeEntities(value) {
  return String(value || '')
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&#039;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replace(/&#(\d+);/gu, (_, code) => String.fromCodePoint(Number(code)));
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function unique(values) {
  return [...new Set(values)];
}

function sha256(value) {
  return createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
