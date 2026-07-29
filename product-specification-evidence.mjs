import { readFile } from 'node:fs/promises';

const COMMERCIAL_FIELD = /(?:price|ціна|цена|вартість|стоимость|stock|залишок|остаток|availability|наявність|наличие|discount|знижк|скидк|promo|акці|акци|delivery|доставк|термін|срок)/iu;

export function buildProductSpecificationEvidence(product, {
  reviewedAt,
  reviewer,
} = {}) {
  const sourceUrl = normalizeOfficialProductUrl(product?.sourceUrl);
  const canonicalUrl = normalizeOfficialProductUrl(product?.canonicalUrl || product?.sourceUrl);
  const capturedAt = validTimestamp(product?.capturedAt);
  const sourceHash = /^[a-f0-9]{64}$/iu.test(String(product?.sourceHash || ''))
    ? String(product.sourceHash).toLowerCase()
    : null;
  const reviewDate = validReviewDate(reviewedAt);
  const safeReviewer = bounded(reviewer, 80);
  const specifications = safeSpecifications(product?.specifications);
  const sku = bounded(product?.sku, 128);
  const name = bounded(product?.name, 240);
  if (
    !sourceUrl
    || !canonicalUrl
    || !capturedAt
    || !sourceHash
    || !reviewDate
    || !safeReviewer
    || !name
    || Object.keys(specifications).length === 0
  ) {
    return null;
  }
  return Object.freeze({
    schemaVersion: '1.0',
    kind: 'product-specification-evidence',
    product: Object.freeze({ sku: sku || null, name, canonicalUrl }),
    specifications: Object.freeze(specifications),
    provenance: Object.freeze({
      source: 'official_public_product_page',
      sourceUrl,
      capturedAt,
      sourceHash,
      reviewedAt: reviewDate,
      reviewer: safeReviewer,
    }),
  });
}

export function mergeProductSpecificationEvidence(current, candidates) {
  const result = new Map();
  for (const item of [...(Array.isArray(current) ? current : []), ...(Array.isArray(candidates) ? candidates : [])]) {
    const normalized = validateEvidence(item);
    if (normalized) result.set(evidenceKey(normalized), normalized);
  }
  return Object.freeze([...result.values()].sort((left, right) => evidenceKey(left).localeCompare(evidenceKey(right))));
}

export function enrichProductsWithSpecificationEvidence(products, evidence) {
  if (!Array.isArray(evidence) || evidence.length === 0) return Array.isArray(products) ? products : [];
  const bySku = new Map();
  const byUrl = new Map();
  for (const item of Array.isArray(evidence) ? evidence : []) {
    const normalized = validateEvidence(item);
    if (!normalized) continue;
    if (normalized.product.sku) bySku.set(normalized.product.sku.toLocaleLowerCase('uk-UA'), normalized);
    byUrl.set(normalized.product.canonicalUrl, normalized);
  }
  return (Array.isArray(products) ? products : []).map((product) => {
    const match = (product?.sku && bySku.get(String(product.sku).toLocaleLowerCase('uk-UA')))
      || (product?.canonicalUrl && byUrl.get(normalizeOfficialProductUrl(product.canonicalUrl)))
      || null;
    if (!match) return product;
    return Object.freeze({
      ...product,
      specifications: Object.freeze({
        ...match.specifications,
        ...(product.specifications || {}),
      }),
      specificationEvidence: match.provenance,
    });
  });
}

export async function loadProductSpecificationEvidence(path) {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8'));
    return mergeProductSpecificationEvidence([], parsed);
  } catch {
    return Object.freeze([]);
  }
}

function validateEvidence(value) {
  if (!value || value.kind !== 'product-specification-evidence') return null;
  return buildProductSpecificationEvidence({
    sku: value.product?.sku,
    name: value.product?.name,
    canonicalUrl: value.product?.canonicalUrl,
    sourceUrl: value.provenance?.sourceUrl,
    capturedAt: value.provenance?.capturedAt,
    sourceHash: value.provenance?.sourceHash,
    specifications: value.specifications,
  }, {
    reviewedAt: value.provenance?.reviewedAt,
    reviewer: value.provenance?.reviewer,
  });
}

function safeSpecifications(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, item]) => [bounded(key, 80), bounded(item, 240)])
      .filter(([key, item]) => key && item && !COMMERCIAL_FIELD.test(key))
      .sort(([left], [right]) => left.localeCompare(right))
      .slice(0, 40),
  );
}

function normalizeOfficialProductUrl(value) {
  try {
    const url = new URL(String(value || ''));
    if (
      url.protocol !== 'https:'
      || url.username
      || url.password
      || !(url.hostname === 'ledprojector.com.ua' || url.hostname.endsWith('.ledprojector.com.ua'))
      || !url.pathname.includes('/proektory/')
    ) return null;
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

function validTimestamp(value) {
  return Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
}

function validReviewDate(value) {
  const normalized = String(value || '');
  return /^\d{4}-\d{2}-\d{2}$/u.test(normalized) && Number.isFinite(Date.parse(`${normalized}T00:00:00Z`))
    ? normalized
    : null;
}

function evidenceKey(item) {
  return item.product.sku?.toLocaleLowerCase('uk-UA') || item.product.canonicalUrl;
}

function bounded(value, maxLength) {
  return String(value ?? '').replace(/\s+/gu, ' ').trim().slice(0, maxLength);
}
