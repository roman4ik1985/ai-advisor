const MAX_ALIASES = 12;
const MAX_IMAGES = 6;
const MAX_SPECIFICATIONS = 24;
const DEFAULT_STORE_ORIGINS = ['https://ledprojector.com.ua', 'https://www.ledprojector.com.ua'];

export function toPublicProduct(rawProduct, {
  source = 'salesdrive_yml',
  fetchedAt = null,
  freshness = 'UNAVAILABLE',
  allowedStoreOrigins = DEFAULT_STORE_ORIGINS,
} = {}) {
  const id = boundedText(rawProduct?.id, 128);
  const sku = boundedText(rawProduct?.sku, 128);
  const name = boundedText(rawProduct?.name, 240);
  if ((!id && !sku) || !name) return null;

  const canonicalId = id || sku;
  const canonicalUrl = safeStoreUrl(rawProduct?.canonicalUrl || rawProduct?.url, allowedStoreOrigins);
  const images = uniqueStrings(
    [rawProduct?.image, ...(Array.isArray(rawProduct?.images) ? rawProduct.images : [])]
      .map((value) => safeStoreUrl(value, allowedStoreOrigins))
      .filter(Boolean),
    MAX_IMAGES,
  );
  const aliases = buildProductAliases({
    id: canonicalId,
    sku,
    name,
    aliases: rawProduct?.aliases,
  });

  return {
    schemaVersion: '1.0',
    id: canonicalId,
    sku,
    name,
    aliases,
    canonicalUrl,
    prices: boundedPrices(rawProduct?.prices),
    oldPrice: boundedText(rawProduct?.oldPrice, 80),
    availability: normalizeAvailability(rawProduct?.availability),
    specifications: boundedSpecifications(rawProduct?.specifications),
    images,
    provenance: {
      source: boundedText(source, 64) || 'unknown',
      sourceId: canonicalId,
    },
    fetchedAt: validTimestamp(fetchedAt),
    freshness: normalizeFreshness(freshness),

    // Compatibility fields used by the existing public catalog renderer.
    url: canonicalUrl,
    image: images[0] || null,
    category: boundedText(rawProduct?.category, 128),
  };
}

export function buildProductAliases({ id, sku, name, aliases = [] } = {}) {
  const provided = Array.isArray(aliases) ? aliases : [];
  const candidates = [
    name,
    ...provided,
    sku,
    id,
    compactAlias(name),
    compactAlias(sku),
  ];
  return uniqueStrings(
    candidates.map((value) => boundedText(value, 160)).filter(Boolean),
    MAX_ALIASES,
    { caseInsensitive: true },
  );
}

export function safeStoreUrl(value, allowedStoreOrigins = DEFAULT_STORE_ORIGINS) {
  try {
    const url = new URL(String(value || '').trim());
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    const allowed = new Set(
      (Array.isArray(allowedStoreOrigins) ? allowedStoreOrigins : [allowedStoreOrigins])
        .map(normalizeOrigin)
        .filter(Boolean),
    );
    if (!allowed.has(url.origin.toLowerCase())) return null;
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

function boundedPrices(values) {
  if (!Array.isArray(values)) return [];
  return uniqueStrings(values.map((value) => boundedText(value, 80)).filter(Boolean), 4);
}

function boundedSpecifications(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, item]) => [boundedText(key, 80), boundedText(item, 240)])
      .filter(([key, item]) => key && item)
      .sort(([left], [right]) => left.localeCompare(right))
      .slice(0, MAX_SPECIFICATIONS),
  );
}

function normalizeAvailability(value) {
  const state = ['IN_STOCK', 'OUT_OF_STOCK', 'UNKNOWN'].includes(value?.state)
    ? value.state
    : 'UNKNOWN';
  const quantity = value?.stockQuantity === null || value?.stockQuantity === undefined
    ? Number.NaN
    : Number(value.stockQuantity);
  return {
    state,
    stockQuantity: Number.isFinite(quantity) && quantity >= 0 ? quantity : null,
  };
}

function normalizeFreshness(value) {
  return ['FRESH', 'STALE', 'UNAVAILABLE'].includes(value) ? value : 'UNAVAILABLE';
}

function validTimestamp(value) {
  if (!value || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

function normalizeOrigin(value) {
  try {
    const url = new URL(String(value || '').trim());
    return url.protocol === 'https:' && !url.username && !url.password
      ? url.origin.toLowerCase()
      : null;
  } catch {
    return null;
  }
}

function compactAlias(value) {
  return boundedText(value, 160)
    ?.normalize('NFKC')
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .toLowerCase() || null;
}

function boundedText(value, maxLength) {
  const normalized = String(value ?? '').replace(/\s+/gu, ' ').trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function uniqueStrings(values, limit, { caseInsensitive = false } = {}) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const key = caseInsensitive ? value.toLocaleLowerCase('uk-UA') : value;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
    if (result.length >= limit) break;
  }
  return result;
}
