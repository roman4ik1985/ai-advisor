import { createHash } from 'node:crypto';

const ACTIONS = new Set(['DEFER', 'DISMISS', 'DRAFT']);

export function parseLearningRecords(text) {
  return parseJsonLines(text)
    .filter((record) => record?.candidate?.status === 'pending')
    .map((record) => Object.freeze(record));
}

export function parseLearningDecisions(text) {
  return parseJsonLines(text)
    .filter((record) => record?.type === 'ai-advisor-learning-review-decision')
    .map((record) => Object.freeze(record));
}

export function buildLearningReviewQueue(records, decisions = []) {
  const latestByRequest = new Map();
  for (const decision of decisions) {
    if (decision?.requestId) latestByRequest.set(String(decision.requestId), decision);
  }
  return Object.freeze(records.map((record) => {
    const requestId = bounded(record.requestId, 80);
    const decision = latestByRequest.get(requestId) || null;
    return Object.freeze({
      requestId,
      timestamp: validTimestamp(record.timestamp),
      reason: bounded(record.candidate?.reason, 80),
      question: bounded(record.question, 1_200),
      answer: bounded(record.answer, 1_200),
      knowledgeIds: Object.freeze(
        (Array.isArray(record.knowledgeIds) ? record.knowledgeIds : [])
          .map((item) => bounded(item, 80))
          .filter(Boolean)
          .slice(0, 4),
      ),
      status: decision ? decision.action : 'PENDING',
      decision,
    });
  }).sort((left, right) => String(left.timestamp).localeCompare(String(right.timestamp))));
}

export function createLearningReviewDecision({
  requestId,
  action,
  note = '',
  sourceUrl = '',
  reviewer,
  now = () => new Date(),
} = {}) {
  const normalizedRequestId = bounded(requestId, 80);
  const normalizedAction = String(action || '').toUpperCase();
  const normalizedReviewer = bounded(reviewer, 80);
  if (!normalizedRequestId || !ACTIONS.has(normalizedAction) || !normalizedReviewer) {
    throw new TypeError('requestId, reviewer, and DEFER/DISMISS/DRAFT action are required.');
  }
  const officialSourceUrl = sourceUrl ? normalizeOfficialUrl(sourceUrl) : null;
  if (normalizedAction === 'DRAFT' && !officialSourceUrl) {
    throw new TypeError('DRAFT requires an official LedProjector source URL.');
  }
  const decidedAt = now().toISOString();
  const decisionId = createHash('sha256')
    .update(`${normalizedRequestId}:${normalizedAction}:${decidedAt}`)
    .digest('hex')
    .slice(0, 24);
  return Object.freeze({
    type: 'ai-advisor-learning-review-decision',
    version: 1,
    decisionId,
    requestId: normalizedRequestId,
    action: normalizedAction,
    reviewer: normalizedReviewer,
    decidedAt,
    note: bounded(note, 500),
    sourceUrl: officialSourceUrl,
    mutatesKnowledge: false,
  });
}

function parseJsonLines(text) {
  const records = [];
  for (const line of String(text || '').split(/\r?\n/gu)) {
    if (!line.trim()) continue;
    try {
      const record = JSON.parse(line);
      if (record && typeof record === 'object' && !Array.isArray(record)) records.push(record);
    } catch {
      // Partial/corrupt lines are isolated from earlier valid records.
    }
  }
  return records;
}

function normalizeOfficialUrl(value) {
  try {
    const url = new URL(String(value || ''));
    if (
      url.protocol !== 'https:'
      || url.username
      || url.password
      || !(url.hostname === 'ledprojector.com.ua' || url.hostname.endsWith('.ledprojector.com.ua'))
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

function bounded(value, maxLength) {
  return String(value ?? '').replace(/\s+/gu, ' ').trim().slice(0, maxLength);
}
