const PRODUCT_CARD_START_PATTERN = /<div[^>]+class=["'][^"']*product-layout[^"']*["'][^>]*>/gi;
const FALLBACK_PRODUCT_PATTERN = /<div[^>]+class=["'][^"']*product-name[^"']*["'][^>]*>\s*<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
const OFFICIAL_HOSTS = new Set(['ledprojector.com.ua', 'www.ledprojector.com.ua']);

export async function searchCatalog(storeUrl, query, fetchImpl = fetch) {
  const normalizedQuery = String(query || '').trim().slice(0, 160);
  if (normalizedQuery.length < 2) {
    return {
      products: [],
      diagnostics: { ok: false, code: 'QUERY_TOO_SHORT', query: normalizedQuery },
    };
  }

  let url;
  try {
    url = buildCatalogSearchUrl(storeUrl, normalizedQuery);
  } catch (error) {
    return {
      products: [],
      diagnostics: { ok: false, code: error.code || 'STORE_URL_NOT_ALLOWED', detail: error.message },
    };
  }

  try {
    const response = await fetchImpl(url, {
      headers: { 'User-Agent': 'LedProjector-AI-Assistant/0.1' },
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      return {
        products: [],
        diagnostics: {
          ok: false,
          code: 'FETCH_FAILED',
          status: response.status,
          statusText: response.statusText,
          requestUrl: url.toString(),
        },
      };
    }

    const html = await response.text();
    const parsed = parseCatalogHtml(html, { baseUrl: url });
    return {
      products: parsed.products.slice(0, 6),
      diagnostics: {
        ok: parsed.products.length > 0,
        code: parsed.products.length > 0 ? 'OK' : 'EMPTY_RESULTS',
        requestUrl: url.toString(),
        parser: parsed.diagnostics.parser,
        cardCount: parsed.diagnostics.cardCount,
        selectorHits: parsed.diagnostics.selectorHits,
      },
    };
  } catch (error) {
    return {
      products: [],
      diagnostics: {
        ok: false,
        code: error?.name === 'TimeoutError' ? 'FETCH_TIMEOUT' : 'FETCH_ERROR',
        detail: error?.message || 'Catalog fetch failed.',
      },
    };
  }
}

export function parseCatalogHtml(html, options = {}) {
  const source = String(html || '');
  const baseUrl = options.baseUrl ? new URL(options.baseUrl) : null;
  const cards = splitProductCards(source);
  const products = [];
  const seen = new Set();
  const selectorHits = {
    itempropUrl: 0,
    productNameLink: 0,
    captionLink: 0,
    imageAlt: 0,
    priceBox: 0,
    priceNew: 0,
    priceOld: 0,
    fallbackRegex: 0,
  };

  for (const cardHtml of cards) {
    const product = extractProductFromCard(cardHtml, baseUrl, selectorHits);
    if (!product || seen.has(product.url)) continue;
    seen.add(product.url);
    products.push(product);
    if (products.length >= 12) break;
  }

  if (products.length === 0) {
    FALLBACK_PRODUCT_PATTERN.lastIndex = 0;
    let match;
    while ((match = FALLBACK_PRODUCT_PATTERN.exec(source)) !== null && products.length < 12) {
      const url = normalizeProductUrl(match[1], baseUrl);
      const name = decodeEntities(stripTags(match[2])).replace(/\s+/g, ' ').trim();
      if (!name || !url || seen.has(url)) continue;
      selectorHits.fallbackRegex += 1;
      seen.add(url);
      const nearby = source.slice(match.index, match.index + 2600);
      products.push({
        name,
        url,
        prices: extractPrices(nearby, selectorHits),
      });
    }
  }

  return {
    products,
    diagnostics: {
      parser: products.length > 0 ? (cards.length > 0 ? 'product-card' : 'fallback-regex') : 'no-match',
      cardCount: cards.length,
      selectorHits,
    },
  };
}

function splitProductCards(source) {
  const starts = [...String(source || '').matchAll(PRODUCT_CARD_START_PATTERN)].map((match) => match.index);
  if (starts.length === 0) return [];

  const cards = [];
  for (let index = 0; index < starts.length; index += 1) {
    const start = starts[index];
    const end = starts[index + 1] ?? source.length;
    cards.push(source.slice(start, end));
  }
  return cards;
}

export function buildCatalogSearchUrl(storeUrl, query) {
  const url = new URL(storeUrl);
  if (!OFFICIAL_HOSTS.has(url.hostname)) {
    const error = new Error(`Unsupported STORE_URL host: ${url.hostname}.`);
    error.code = 'STORE_URL_NOT_ALLOWED';
    throw error;
  }

  url.protocol = 'https:';
  url.pathname = '/index.php';
  url.search = '';
  url.hash = '';
  url.searchParams.set('route', 'product/search');
  url.searchParams.set('search', String(query || '').trim().slice(0, 160));
  return url;
}

function extractProductFromCard(cardHtml, baseUrl, selectorHits) {
  const primaryLink = findFirstMatch(cardHtml, /<a[^>]+itemprop=["']url["'][^>]+href=["']([^"']+)["'][^>]*>/i);
  const titleLink = findFirstMatch(cardHtml, /<div[^>]+class=["'][^"']*product-name[^"']*["'][^>]*>\s*<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
  const captionLink = findFirstMatch(cardHtml, /<div[^>]+class=["'][^"']*caption[^"']*["'][^>]*>[\s\S]*?<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
  const imageAlt = findFirstMatch(cardHtml, /<img[^>]+alt=["']([^"']+)["'][^>]*>/i);

  const rawUrl = primaryLink?.[1] || titleLink?.[1] || captionLink?.[1];
  const name = (
    titleLink?.[2]
      || captionLink?.[2]
      || imageAlt?.[1]
      || ''
  );

  if (primaryLink) selectorHits.itempropUrl += 1;
  if (titleLink) selectorHits.productNameLink += 1;
  if (captionLink) selectorHits.captionLink += 1;
  if (imageAlt) selectorHits.imageAlt += 1;

  const url = normalizeProductUrl(rawUrl, baseUrl);
  const cleanName = decodeEntities(stripTags(name)).replace(/\s+/g, ' ').trim();
  if (!url || !cleanName) return null;

  return {
    name: cleanName,
    url,
    prices: extractPrices(cardHtml, selectorHits),
  };
}

function extractPrices(cardHtml, selectorHits) {
  const priceBox = findFirstMatch(cardHtml, /<div[^>]+class=["'][^"']*price[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
  const priceNew = findAllMatches(cardHtml, /<span[^>]+class=["'][^"']*price-new[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi)
    .map((match) => normalizePrice(match[1]))
    .filter(Boolean);
  const priceOld = findAllMatches(cardHtml, /<span[^>]+class=["'][^"']*price-old[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi)
    .map((match) => normalizePrice(match[1]))
    .filter(Boolean);

  if (priceBox) selectorHits.priceBox += 1;
  if (priceNew.length > 0) selectorHits.priceNew += priceNew.length;
  if (priceOld.length > 0) selectorHits.priceOld += priceOld.length;

  const prices = [];
  for (const value of [...priceOld, ...priceNew, ...(priceBox ? extractPriceTokens(priceBox[1]) : []), ...extractPriceTokens(cardHtml)]) {
    if (value && !prices.includes(value)) prices.push(value);
    if (prices.length >= 2) break;
  }
  return prices;
}

function extractPriceTokens(fragment) {
  const text = stripTags(fragment);
  return [...String(text || '').matchAll(/([\d\s]{2,})\s*(?:грн\.?|₴)/gi)]
    .map((match) => normalizePrice(match[0]))
    .filter(Boolean);
}

function normalizePrice(value) {
  const text = decodeEntities(stripTags(value)).replace(/\s+/g, ' ').trim();
  const match = text.match(/([\d\s]{2,})\s*(?:грн\.?|₴)/i);
  if (!match) return '';
  return `${match[1].replace(/\s+/g, ' ').trim()} грн.`;
}

function normalizeProductUrl(value, baseUrl) {
  const href = decodeEntities(String(value || '')).trim();
  if (!href) return '';

  try {
    const url = baseUrl ? new URL(href, baseUrl) : new URL(href);
    if (!OFFICIAL_HOSTS.has(url.hostname)) return '';
    url.hash = '';
    return url.toString();
  } catch {
    return '';
  }
}

function findFirstMatch(value, pattern) {
  return String(value || '').match(pattern);
}

function findAllMatches(value, pattern) {
  return [...String(value || '').matchAll(pattern)];
}

function stripTags(value) {
  return String(value).replace(/<[^>]*>/g, ' ');
}

function decodeEntities(value) {
  return String(value)
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&#039;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
}
