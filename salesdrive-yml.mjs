const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_MAX_BYTES = 4 * 1024 * 1024;
const DEFAULT_CACHE_TTL_MS = 2 * 60 * 1000;
const DEFAULT_MAX_STALE_MS = 10 * 60 * 1000;

export function createSalesdriveYmlClient({
  ymlUrl = process.env.SALESDRIVE_YML_URL,
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxBytes = DEFAULT_MAX_BYTES,
  cacheTtlMs = DEFAULT_CACHE_TTL_MS,
  maxStaleMs = DEFAULT_MAX_STALE_MS,
} = {}) {
  const configuredUrl = parseYmlUrl(ymlUrl);
  let cache = null;

  async function search(query) {
    if (!configuredUrl) return unavailable('SALES_DRIVE_YML_NOT_CONFIGURED');

    try {
      const feed = await getFeed();
      const products = selectProducts(feed.products, query);
      return {
        products,
        diagnostics: {
          code: products.length > 0 ? 'OK' : 'EMPTY_RESULTS',
          source: 'salesdrive_yml',
        },
        source: 'salesdrive_yml',
        fetchedAt: feed.fetchedAt,
        freshness: 'FRESH',
      };
    } catch (error) {
      if (cache && Date.parse(cache.fetchedAt) + maxStaleMs >= now().getTime()) {
        const products = selectProducts(cache.products, query);
        return {
          products,
          diagnostics: { code: 'STALE_LAST_KNOWN_GOOD', source: 'salesdrive_yml' },
          source: 'salesdrive_yml',
          fetchedAt: cache.fetchedAt,
          freshness: 'STALE',
        };
      }
      return unavailable(error?.code || 'SALES_DRIVE_YML_UNAVAILABLE');
    }
  }

  async function getFeed() {
    if (cache && Date.parse(cache.fetchedAt) + cacheTtlMs >= now().getTime()) return cache;
    const xml = await fetchYml(configuredUrl, { fetchImpl, timeoutMs, maxBytes });
    const products = parseSalesdriveYml(xml);
    cache = { products, fetchedAt: now().toISOString() };
    return cache;
  }

  return { configured: Boolean(configuredUrl), search };
}

export function parseSalesdriveYml(xml) {
  const source = String(xml || '');
  if (/<!DOCTYPE|<!ENTITY/iu.test(source)) throw codedError('YML_UNSAFE_XML');

  return [...source.matchAll(/<offer\b([^>]*)>([\s\S]*?)<\/offer>/giu)]
    .map((match) => parseOffer(match[1], match[2]))
    .filter((product) => product?.name || product?.sku || product?.id);
}

function parseOffer(attributes, body) {
  const price = tag(body, 'price');
  const currency = tag(body, 'currencyId') || tag(body, 'currency') || 'UAH';
  const stockQuantity = numberTag(body, [
    'stock_quantity',
    'stockQuantity',
    'available_quantity',
    'availableQuantity',
    'restCount',
    'rest_count',
    'quantity',
  ]);
  const available = attribute(attributes, 'available');
  const availability = normalizeAvailability({ stockQuantity, available });
  const name = tag(body, 'name') || tag(body, 'model') || tag(body, 'vendor') || '';
  const sku = tag(body, 'vendorCode') || tag(body, 'sku') || attribute(attributes, 'id') || null;
  const id = attribute(attributes, 'id') || sku || name || null;

  return {
    id,
    sku,
    name,
    url: tag(body, 'url') || null,
    image: tag(body, 'picture') || null,
    category: tag(body, 'categoryId') || null,
    prices: price ? [formatPrice(price, currency)] : [],
    oldPrice: tag(body, 'oldprice') ? formatPrice(tag(body, 'oldprice'), currency) : null,
    availability,
  };
}

function selectProducts(products, query) {
  const tokens = normalizeTokens(query);
  const ranked = (Array.isArray(products) ? products : [])
    .map((product) => ({ product, score: scoreProduct(product, tokens) }))
    .filter(({ score }) => tokens.length === 0 || score > 0)
    .sort((left, right) => right.score - left.score || String(left.product.name).localeCompare(String(right.product.name)))
    .slice(0, 12)
    .map(({ product }) => product);
  return ranked;
}

function scoreProduct(product, tokens) {
  const haystack = `${product?.name || ''} ${product?.sku || ''} ${product?.id || ''}`.toLowerCase();
  return tokens.reduce((score, token) => score + (haystack.includes(token) ? token.length : 0), 0);
}

function normalizeTokens(query) {
  const ignored = new Set(['есть', 'ли', 'товар', 'проектор', 'модель', 'цена', 'цены', 'наличии', 'наличие', 'можно', 'заказать', 'какая', 'какой', 'покажите', 'покажи', 'порадьте', 'порекомендуйте', 'чи', 'є', 'в', 'на', 'для', 'the', 'and']);
  return [...new Set(String(query || '').toLowerCase().match(/[\p{L}\p{N}-]{2,}/gu) || [])]
    .filter((token) => !ignored.has(token))
    .slice(0, 12);
}

function normalizeAvailability({ stockQuantity, available }) {
  const normalizedAvailable = String(available || '').toLowerCase();
  if (Number.isFinite(stockQuantity)) {
    return { state: stockQuantity > 0 ? 'IN_STOCK' : 'OUT_OF_STOCK', stockQuantity };
  }
  if (normalizedAvailable === 'true' || normalizedAvailable === '1') return { state: 'IN_STOCK', stockQuantity: null };
  if (normalizedAvailable === 'false' || normalizedAvailable === '0') return { state: 'OUT_OF_STOCK', stockQuantity: null };
  return { state: 'UNKNOWN', stockQuantity: null };
}

async function fetchYml(url, { fetchImpl, timeoutMs, maxBytes }) {
  if (typeof fetchImpl !== 'function') throw codedError('YML_FETCH_UNAVAILABLE');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      redirect: 'manual',
      headers: { Accept: 'application/xml, text/xml;q=0.9' },
      signal: controller.signal,
    });
    if (!response?.ok) throw codedError(response?.status >= 300 && response?.status < 400 ? 'YML_REDIRECT_BLOCKED' : 'YML_FETCH_FAILED');
    const contentLength = Number(response.headers?.get?.('content-length'));
    if (Number.isFinite(contentLength) && contentLength > maxBytes) throw codedError('YML_TOO_LARGE');
    return readResponseText(response, maxBytes);
  } catch (error) {
    if (error?.name === 'AbortError') throw codedError('YML_TIMEOUT');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function readResponseText(response, maxBytes) {
  if (!response.body?.getReader) {
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > maxBytes) throw codedError('YML_TOO_LARGE');
    return text;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw codedError('YML_TOO_LARGE');
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(concatChunks(chunks, size));
}

function concatChunks(chunks, size) {
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function tag(body, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const match = new RegExp(`<${escaped}\\b[^>]*>([\\s\\S]*?)<\\/${escaped}>`, 'iu').exec(body);
  return match ? cleanXmlText(match[1]) : null;
}

function numberTag(body, names) {
  for (const name of names) {
    const value = tag(body, name);
    if (value === null) continue;
    const number = Number.parseFloat(value.replace(',', '.'));
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function attribute(attributes, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const match = new RegExp(`${escaped}\\s*=\\s*["']([^"']*)["']`, 'iu').exec(attributes);
  return match ? cleanXmlText(match[1]) : null;
}

function cleanXmlText(value) {
  return String(value || '')
    .replace(/<[^>]+>/gu, ' ')
    .replace(/&quot;/giu, '"')
    .replace(/&apos;/giu, "'")
    .replace(/&amp;/giu, '&')
    .replace(/&lt;/giu, '<')
    .replace(/&gt;/giu, '>')
    .replace(/\s+/gu, ' ')
    .trim();
}

function formatPrice(value, currency) {
  const numeric = Number.parseFloat(String(value).replace(',', '.'));
  if (!Number.isFinite(numeric)) return `${value} ${currency}`.trim();
  const display = Number.isInteger(numeric)
    ? numeric.toLocaleString('uk-UA')
    : numeric.toLocaleString('uk-UA', { maximumFractionDigits: 2 });
  return `${display} ${normalizeCurrency(currency)}`;
}

function normalizeCurrency(currency) {
  const normalized = String(currency || '').trim().toUpperCase();
  return normalized === 'UAH' || normalized === 'GRN' ? 'грн.' : normalized;
}

function parseYmlUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    return url.protocol === 'https:' && url.username === '' && url.password === '' ? url.toString() : null;
  } catch {
    return null;
  }
}

function unavailable(code) {
  return {
    products: [],
    diagnostics: { code, source: 'salesdrive_yml' },
    source: 'salesdrive_yml',
    fetchedAt: null,
    freshness: 'UNAVAILABLE',
  };
}

function codedError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}
