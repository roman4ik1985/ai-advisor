const DEFAULT_SOURCE_HOST = 'ledprojector.com.ua';
const REVIEWED_AT_RE = /^\d{4}-\d{2}-\d{2}$/;

export function validateKnowledgeEntries(entries) {
  if (!Array.isArray(entries)) {
    throw new Error('Knowledge base must be an array.');
  }

  const seenIds = new Set();
  const normalizedEntries = entries.map((entry, index) => normalizeKnowledgeEntry(entry, index, seenIds));
  if (normalizedEntries.length === 0) {
    throw new Error('Knowledge base must contain at least one entry.');
  }

  return normalizedEntries;
}

function normalizeKnowledgeEntry(entry, index, seenIds) {
  if (!isRecord(entry)) {
    throw new Error(`Knowledge entry ${index + 1} must be an object.`);
  }

  const id = takeString(entry.id, 80);
  const title = takeString(entry.title, 160);
  const text = takeString(entry.text, 1800);
  const sourceUrl = takeString(entry.sourceUrl, 500);
  const reviewedAt = takeString(entry.reviewedAt, 32);
  const keywords = normalizeKeywords(entry.keywords);

  if (!id) throw new Error(`Knowledge entry ${index + 1} is missing id.`);
  if (seenIds.has(id)) throw new Error(`Duplicate knowledge entry id: ${id}.`);
  seenIds.add(id);

  if (!title) throw new Error(`Knowledge entry ${id} is missing title.`);
  if (!text) throw new Error(`Knowledge entry ${id} is missing text.`);
  if (!sourceUrl) throw new Error(`Knowledge entry ${id} is missing sourceUrl.`);
  if (!reviewedAt) throw new Error(`Knowledge entry ${id} is missing reviewedAt.`);
  if (keywords.length === 0) throw new Error(`Knowledge entry ${id} must have at least one keyword.`);

  const url = parseUrl(sourceUrl, id);
  if (!isAllowedSourceHost(url.hostname)) {
    throw new Error(`Knowledge entry ${id} must use the official LedProjector domain.`);
  }

  if (!REVIEWED_AT_RE.test(reviewedAt) || Number.isNaN(Date.parse(`${reviewedAt}T00:00:00Z`))) {
    throw new Error(`Knowledge entry ${id} has invalid reviewedAt: ${reviewedAt}.`);
  }

  const reviewedDate = new Date(`${reviewedAt}T00:00:00Z`);
  if (reviewedDate > new Date(Date.now() + 24 * 60 * 60 * 1000)) {
    throw new Error(`Knowledge entry ${id} has reviewedAt in the future: ${reviewedAt}.`);
  }

  return {
    id,
    title,
    keywords,
    sourceUrl,
    reviewedAt,
    text,
  };
}

function normalizeKeywords(value) {
  if (!Array.isArray(value)) return [];

  const seen = new Set();
  const keywords = [];

  for (const item of value) {
    const keyword = takeString(item, 64);
    if (!keyword) continue;
    const normalized = keyword.toLowerCase();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    keywords.push(keyword);
  }

  return keywords;
}

function takeString(value, maxLength) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function parseUrl(value, id) {
  try {
    return new URL(value);
  } catch {
    throw new Error(`Knowledge entry ${id} has invalid sourceUrl: ${value}.`);
  }
}

function isAllowedSourceHost(hostname) {
  return hostname === DEFAULT_SOURCE_HOST || hostname.endsWith(`.${DEFAULT_SOURCE_HOST}`);
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
