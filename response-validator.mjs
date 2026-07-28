const PRICE_PATTERN = /\d[\d\s]{1,12}(?:[,.]\d{1,2})?\s*(?:грн\.?|₴|uah)/giu;
const AVAILABILITY_PATTERN = /(?:є|есть)\s+(?:в\s+)?(?:наявност[іi]|наличи[ие])|(?:товар|проектор|модель)\s+(?:є|есть|доступн\w+)/iu;
const DELIVERY_DEADLINE_PATTERN = /(?:доставимо|доставим|відправимо|отправим|привеземо|привезем|буде доставлено|будет доставлен[оа]?).{0,32}(?:сьогодні|сегодня|завтра|післязавтра|послезавтра|\d+\s*(?:дн\w*|день\w*|годин\w*|час\w*))|(?:доставка|доставлення)\s+(?:за|протягом|в\s+течение)\s+\d+\s*(?:дн\w*|день\w*|годин\w*|час\w*)/iu;
const WARRANTY_PATTERN = /(?:гаранті\w*|гаранти\w*)/iu;
const WARRANTY_DURATION_PATTERN = /\d{1,3}\s*(?:місяц\w*|месяц\w*|міс\.?|мес\.?|рок\w*|год\w*|лет)/giu;

export function validateAssistantAnswer({ answer, catalog = [], knowledge = [], question = '' }) {
  const safeAnswer = String(answer || '').trim();
  const reasons = [];

  if (!safeAnswer) reasons.push('EMPTY_ANSWER');
  if (hasUnverifiedPrice(safeAnswer, catalog)) reasons.push('UNVERIFIED_PRICE');
  if (AVAILABILITY_PATTERN.test(safeAnswer)) reasons.push('UNVERIFIED_AVAILABILITY');
  if (DELIVERY_DEADLINE_PATTERN.test(safeAnswer)) reasons.push('UNVERIFIED_DELIVERY_DEADLINE');
  if (hasUnverifiedWarranty(safeAnswer, knowledge)) reasons.push('UNVERIFIED_WARRANTY_TERM');

  return reasons.length === 0
    ? { accepted: true, answer: safeAnswer, reasons }
    : { accepted: false, answer: safeFallback(question), reasons };
}

function hasUnverifiedPrice(answer, catalog) {
  const answerPrices = extractPrices(answer);
  if (answerPrices.length === 0) return false;
  const catalogPrices = new Set(
    (Array.isArray(catalog) ? catalog : [])
      .flatMap((product) => Array.isArray(product?.prices) ? product.prices : [])
      .flatMap(extractPrices),
  );
  return answerPrices.some((price) => !catalogPrices.has(price));
}

function hasUnverifiedWarranty(answer, knowledge) {
  if (!WARRANTY_PATTERN.test(answer)) return false;
  const answerDurations = extractWarrantyDurations(answer);
  if (answerDurations.length === 0) return false;
  const knowledgeText = (Array.isArray(knowledge) ? knowledge : [])
    .map((entry) => `${entry?.title || ''} ${entry?.text || ''}`)
    .join('\n');
  const supportedDurations = new Set(extractWarrantyDurations(knowledgeText));
  return answerDurations.some((duration) => !supportedDurations.has(duration));
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

function isUkrainian(question) {
  const text = String(question || '');
  return /[іїєґ]/iu.test(text) || !/[а-яё]/iu.test(text);
}
