import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const EVENT_TYPES = new Set(['PRODUCT_CARD_SHOWN', 'PRODUCT_CARD_OPENED', 'PRODUCT_GUIDE_USED']);
const RETENTION_DAYS = 30;

export const PRODUCT_ANALYTICS_CONTRACT = Object.freeze({
  eventTypes: Object.freeze([...EVENT_TYPES]),
  retentionDays: RETENTION_DAYS,
  identifiers: Object.freeze(['productKey']),
  forbidden: Object.freeze(['ip', 'cookie', 'session', 'userAgent', 'email', 'phone', 'question', 'answer']),
});

export function createProductAnalytics({
  enabled = false,
  path,
  now = () => new Date(),
  append = appendFile,
} = {}) {
  const active = enabled === true && typeof path === 'string' && path.trim();

  async function record(input) {
    if (!active) return false;
    const event = normalizeProductAnalyticsEvent(input, now());
    if (!event) return false;
    await mkdir(dirname(path), { recursive: true });
    await append(path, `${JSON.stringify(event)}\n`, 'utf8');
    return true;
  }

  return Object.freeze({ enabled: Boolean(active), record });
}

export function normalizeProductAnalyticsEvent(input, timestamp = new Date()) {
  const allowedKeys = ['type', 'version', 'timestamp', 'eventType', 'productKey'];
  if (!isPlainObject(input) || Object.keys(input).some((key) => !allowedKeys.includes(key))) return null;
  const eventType = String(input.eventType || '').toUpperCase();
  const productKey = String(input.productKey || '').trim();
  if (!EVENT_TYPES.has(eventType) || !/^[A-Za-z0-9:_./-]{1,160}$/u.test(productKey)) return null;
  return Object.freeze({
    type: 'ai-advisor-product-analytics',
    version: 1,
    timestamp: timestamp.toISOString(),
    eventType,
    productKey,
  });
}

export function retainProductAnalytics(text, {
  now = () => new Date(),
  retentionDays = RETENTION_DAYS,
} = {}) {
  const cutoff = now().getTime() - Math.max(1, retentionDays) * 86_400_000;
  const retained = [];
  let dropped = 0;
  for (const line of String(text || '').split(/\r?\n/gu)) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      const normalized = normalizeProductAnalyticsEvent(parsed, new Date(parsed.timestamp));
      if (normalized && Date.parse(normalized.timestamp) >= cutoff) retained.push(normalized);
      else dropped += 1;
    } catch {
      dropped += 1;
    }
  }
  return Object.freeze({ retained: Object.freeze(retained), dropped });
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
