const PRICE_PATTERN = /\d[\d\s]{1,12}(?:[,.]\d{1,2})?\s*(?:грн\.?|₴|uah)/giu;
const AVAILABILITY_PATTERN = /(?:є|есть)\s+(?:в\s+)?(?:наявност[іi]|наличи[ие])|(?:товар|проектор|модель)\s+(?:є|есть|доступн\w+)/iu;
const DELIVERY_DEADLINE_PATTERN = /(?:доставимо|доставим|відправимо|отправим|привеземо|привезем|буде доставлено|будет доставлен[оа]?).{0,32}(?:сьогодні|сегодня|завтра|післязавтра|послезавтра|\d+\s*(?:дн\w*|день\w*|годин\w*|час\w*))|(?:доставка|доставлення)\s+(?:за|протягом|в\s+течение)\s+\d+\s*(?:дн\w*|день\w*|годин\w*|час\w*)/iu;
const WARRANTY_PATTERN = /(?:гаранті\w*|гаранти\w*)/iu;
const WARRANTY_DURATION_PATTERN = /\d{1,3}\s*(?:місяц\w*|месяц\w*|міс\.?|мес\.?|рок\w*|год\w*|лет)/giu;

export function validateAssistantAnswer({ answer, catalog = [], knowledge = [], question = '', freshness = {}, route = {}, now = () => new Date() }) {
  const safeAnswer = String(answer || '').trim();
  const reasons = [];

  if (!safeAnswer) reasons.push('EMPTY_ANSWER');
  if (hasUnverifiedPrice(safeAnswer, catalog, freshness, now)) reasons.push('UNVERIFIED_PRICE');
  if (hasUnverifiedAvailability(safeAnswer, freshness)) reasons.push('UNVERIFIED_AVAILABILITY');
  if (hasUnverifiedDelivery(safeAnswer, freshness)) reasons.push('UNVERIFIED_DELIVERY_DEADLINE');
  if (hasUnverifiedWarranty(safeAnswer, knowledge, freshness, now)) reasons.push('UNVERIFIED_WARRANTY_TERM');

  const action = validationAction(reasons, route);
  return action === 'ALLOW'
    ? { accepted: true, action, answer: safeAnswer, reasons }
    : { accepted: false, action, answer: safeFallback(question), reasons };
}

function hasUnverifiedPrice(answer, catalog, freshness, now) {
  const answerPrices = extractPrices(answer);
  if (answerPrices.length === 0) return false;
  if (!hasFreshCatalogEvidence(freshness, now)) return true;
  const catalogPrices = new Set(
    (Array.isArray(catalog) ? catalog : [])
      .flatMap((product) => Array.isArray(product?.prices) ? product.prices : [])
      .flatMap(extractPrices),
  );
  return answerPrices.some((price) => !catalogPrices.has(price));
}

function hasUnverifiedAvailability(answer, freshness) {
  return AVAILABILITY_PATTERN.test(answer) && !hasAvailableLiveResolver(freshness, 'inventory');
}

function hasUnverifiedDelivery(answer, freshness) {
  return DELIVERY_DEADLINE_PATTERN.test(answer) && !hasAvailableLiveResolver(freshness, 'delivery');
}

function hasAvailableLiveResolver(freshness, resolver) {
  const evidence = freshness?.live?.[resolver];
  return evidence?.status === 'AVAILABLE' && Number.isFinite(Date.parse(String(evidence.checkedAt || '')));
}

function hasUnverifiedWarranty(answer, knowledge, freshness, now) {
  if (!WARRANTY_PATTERN.test(answer)) return false;
  const answerDurations = extractWarrantyDurations(answer);
  if (answerDurations.length === 0) return false;
  const knowledgeText = (Array.isArray(knowledge) ? knowledge : [])
    .filter((entry) => hasFreshKnowledgeEvidence(entry, freshness, now))
    .map((entry) => `${entry?.title || ''} ${entry?.text || ''}`)
    .join('\n');
  const supportedDurations = new Set(extractWarrantyDurations(knowledgeText));
  return answerDurations.some((duration) => !supportedDurations.has(duration));
}

function hasFreshCatalogEvidence(freshness, now) {
  const catalog = freshness?.catalog;
  if (!catalog?.queried || catalog.code !== 'OK') return false;
  const fetchedAt = Date.parse(String(catalog.fetchedAt || ''));
  const current = asTime(now);
  return Number.isFinite(fetchedAt) && Number.isFinite(current) && fetchedAt <= current && current - fetchedAt <= 10 * 60 * 1000;
}

function hasFreshKnowledgeEvidence(entry, freshness, now) {
  const reviewedAt = Date.parse(`${String(entry?.reviewedAt || '')}T00:00:00Z`);
  const current = asTime(now);
  const maxAgeDays = Number(freshness?.knowledge?.maxAgeDays || 0);
  return Number.isFinite(reviewedAt)
    && Number.isFinite(current)
    && maxAgeDays > 0
    && reviewedAt <= current
    && current - reviewedAt <= maxAgeDays * 24 * 60 * 60 * 1000;
}

function asTime(now) {
  const value = typeof now === 'function' ? now() : now;
  return value instanceof Date ? value.getTime() : Date.parse(String(value || ''));
}

function extractPrices(text) {
  return Array.from(String(text || '').matchAll(PRICE_PATTERN), (match) => normalizePrice(match[0]));
}

function normalizePrice(value) {
  return String(value).replace(/\D/gu, '');
}

function extractWarrantyDurations(text) {
  return Array.from(String(text || '').matchAll(WARRANTY_DURATION_PATTERN), (match) => normalizeDuration(match[0]));
}

function normalizeDuration(value) {
  return String(value)
    .toLowerCase()
    .replace(/\s+/gu, ' ')
    .replace(/місяц\w*|месяц\w*|міс\.?|мес\.?/gu, 'month')
    .replace(/рок\w*|год\w*|лет/gu, 'year')
    .replace(/\s+/gu, ' ')
    .trim();
}

function safeFallback(question) {
  return isUkrainian(question)
    ? 'Щоб не надати неточну інформацію щодо ціни, наявності або умов, будь ласка, уточніть це у менеджера магазину.'
    : 'Чтобы не дать неточную информацию о цене, наличии или условиях, пожалуйста, уточните это у менеджера магазина.';
}

function validationAction(reasons, route) {
  if (route?.route === 'ESCALATE') return 'ESCALATE';
  if (reasons.length === 0) return 'ALLOW';
  if (reasons.includes('EMPTY_ANSWER')) return 'REGENERATE';
  if (reasons.some((reason) => reason === 'UNVERIFIED_AVAILABILITY' || reason === 'UNVERIFIED_DELIVERY_DEADLINE')) return 'ESCALATE';
  return 'REWRITE';
}

function isUkrainian(question) {
  const text = String(question || '');
  return /[іїєґ]/iu.test(text) || !/[а-яё]/iu.test(text);
}
