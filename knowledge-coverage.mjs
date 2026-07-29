const MAX_AGE_DAYS = 180;

export function buildKnowledgeCoverage({
  entries = [],
  learningRecords = [],
  decisions = [],
  now = () => new Date(),
} = {}) {
  const current = now();
  const decided = new Set(
    decisions
      .filter((item) => ['DISMISS', 'DRAFT'].includes(item?.action))
      .map((item) => String(item.requestId || '')),
  );
  const pending = learningRecords
    .filter((record) => record?.candidate?.status === 'pending')
    .filter((record) => !decided.has(String(record.requestId || '')));
  const staleEntries = entries
    .filter((entry) => ageDays(entry?.reviewedAt, current) > MAX_AGE_DAYS)
    .map((entry) => String(entry.id || ''))
    .filter(Boolean)
    .sort();
  const sourceCounts = new Map();
  const keywordCounts = new Map();
  for (const entry of entries) {
    const sourceUrl = safeOfficialUrl(entry?.sourceUrl);
    if (sourceUrl) sourceCounts.set(sourceUrl, (sourceCounts.get(sourceUrl) || 0) + 1);
    for (const keyword of Array.isArray(entry?.keywords) ? entry.keywords : []) {
      const normalized = normalizeText(keyword).toLocaleLowerCase('uk-UA');
      if (normalized) keywordCounts.set(normalized, (keywordCounts.get(normalized) || 0) + 1);
    }
  }
  const gaps = pending.map((record) => Object.freeze({
    requestId: bounded(record.requestId, 80),
    reason: bounded(record.candidate?.reason, 80),
    question: bounded(record.question, 1_200),
    recommendedAction: 'REVIEW_OFFICIAL_SOURCE',
  }));

  return Object.freeze({
    schemaVersion: '1.0',
    generatedAt: current.toISOString(),
    summary: Object.freeze({
      knowledgeEntries: entries.length,
      officialSources: sourceCounts.size,
      staleEntries: staleEntries.length,
      pendingGaps: gaps.length,
    }),
    staleEntryIds: Object.freeze(staleEntries),
    repeatedSources: Object.freeze(
      [...sourceCounts.entries()]
        .filter(([, count]) => count > 1)
        .map(([sourceUrl, entryCount]) => Object.freeze({ sourceUrl, entryCount }))
        .sort((left, right) => right.entryCount - left.entryCount || left.sourceUrl.localeCompare(right.sourceUrl)),
    ),
    topKeywords: Object.freeze(
      [...keywordCounts.entries()]
        .map(([keyword, entryCount]) => Object.freeze({ keyword, entryCount }))
        .sort((left, right) => right.entryCount - left.entryCount || left.keyword.localeCompare(right.keyword))
        .slice(0, 30),
    ),
    gaps: Object.freeze(gaps),
    mutationAllowed: false,
  });
}

function ageDays(value, now) {
  const reviewedAt = Date.parse(`${String(value || '')}T00:00:00Z`);
  return Number.isFinite(reviewedAt)
    ? Math.floor((now.getTime() - reviewedAt) / 86_400_000)
    : Number.POSITIVE_INFINITY;
}

function safeOfficialUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:'
      && (url.hostname === 'ledprojector.com.ua' || url.hostname.endsWith('.ledprojector.com.ua'))
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function normalizeText(value) {
  return String(value ?? '').replace(/\s+/gu, ' ').trim();
}

function bounded(value, maxLength) {
  return normalizeText(value).slice(0, maxLength);
}
