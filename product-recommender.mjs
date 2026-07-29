const MAX_RESULTS = 3;

const RECOMMEND_PATTERN = /(?:подбер|порад|порекоменду|посовет|какой.*выбрать|який.*обрат|підібрат|для\s+(?:дома|комнат|кімнат)|бюджет|яркост|яскравіст)/iu;
const COMPARE_PATTERN = /(?:сравн|порівн)/iu;

const SPEC_CONCEPTS = Object.freeze([
  {
    id: 'brightness',
    request: /(?:яркост|яскрав)/iu,
    key: /(?:яркост|яскрав)/iu,
    labels: { uk: 'яскравість', ru: 'яркость' },
  },
  {
    id: 'resolution',
    request: /(?:разрешени|роздільн|розширенн|full\s*hd|4k|4к|1080p|720p)/iu,
    key: /(?:рідне.*(?:розширенн|роздільн)|native.*resolution|разрешени|роздільн|розширенн)/iu,
    labels: { uk: 'рідна роздільна здатність', ru: 'родное разрешение' },
  },
  {
    id: 'wifi',
    request: /(?:wi[\s-]?fi|вай[\s-]?фай)/iu,
    key: /(?:бездротові модулі|беспроводн.*модул|wi[\s-]?fi)/iu,
    labels: { uk: 'Wi-Fi', ru: 'Wi-Fi' },
  },
  {
    id: 'bluetooth',
    request: /(?:bluetooth|блютуз)/iu,
    key: /(?:бездротові модулі|беспроводн.*модул|bluetooth)/iu,
    labels: { uk: 'Bluetooth', ru: 'Bluetooth' },
  },
  {
    id: 'inputLag',
    request: /(?:input\s*lag|затримк.*вводу|задержк.*ввода|для\s+(?:ps5|playstation|xbox|ігор|игр))/iu,
    key: /(?:input\s*lag|затримк.*вводу|задержк.*ввода)/iu,
    labels: { uk: 'затримка вводу', ru: 'задержка ввода' },
  },
  {
    id: 'battery',
    request: /(?:акумулятор|аккумулятор|автономн)/iu,
    key: /(?:акумулятор|аккумулятор)/iu,
    labels: { uk: 'акумулятор', ru: 'аккумулятор' },
  },
]);

export function buildProductRecommendation({
  question = '',
  products = [],
  maxResults = MAX_RESULTS,
} = {}) {
  const language = detectLanguage(question);
  const mode = detectMode(question);
  const limit = Math.max(1, Math.min(MAX_RESULTS, Number(maxResults) || MAX_RESULTS));
  const requestedConcepts = SPEC_CONCEPTS.filter((concept) => concept.request.test(String(question)));
  const budget = extractBudget(question);
  const eligible = (Array.isArray(products) ? products : []).filter(hasRequiredEvidence);

  if (mode === 'NONE') {
    return result({ mode, language, status: 'NEEDS_CLARIFICATION', reasons: ['NO_RECOMMENDATION_OR_COMPARISON_INTENT'] });
  }

  if (mode === 'COMPARE') {
    return buildComparison({ question, eligible, requestedConcepts, language, limit });
  }

  return buildRecommendation({ question, eligible, requestedConcepts, budget, language, limit });
}

function buildComparison({ question, eligible, requestedConcepts, language, limit }) {
  const matches = eligible
    .map((product) => ({ product, match: exactIdentityMatch(product, question) }))
    .filter(({ match }) => match)
    .sort((left, right) => right.match.length - left.match.length || stableProductOrder(left.product, right.product))
    .slice(0, limit)
    .map(({ product }) => product);

  if (matches.length < 2) {
    return result({
      mode: 'COMPARE',
      language,
      status: 'NEEDS_CLARIFICATION',
      reasons: ['TWO_EXACT_PRODUCTS_REQUIRED'],
      answer: language === 'ru'
        ? 'Укажите точные названия или артикулы как минимум двух моделей для сравнения.'
        : 'Укажіть точні назви або артикули щонайменше двох моделей для порівняння.',
    });
  }

  const fields = requestedConcepts.length > 0
    ? requestedConcepts.map((concept) => ({
      label: concept.labels[language],
      find: (product) => findSpecification(product, concept.key)?.value || null,
    }))
    : comparisonSpecificationFields(matches);
  const evidence = matches.map((product) => productEvidence(product, fields));
  const lines = evidence.map((item) => {
    const facts = [
      `${language === 'ru' ? 'цена' : 'ціна'} — ${item.price || unconfirmed(language)}`,
      ...item.facts.map((fact) => `${fact.label} — ${fact.value || unconfirmed(language)}`),
    ];
    return `- ${item.name}: ${facts.join('; ')}.`;
  });
  const answer = [
    language === 'ru' ? 'Сравнение по подтверждённым данным:' : 'Порівняння за підтвердженими даними:',
    ...lines,
    language === 'ru'
      ? 'Победителя не определяю: выбор зависит от ваших приоритетов, а неподтверждённые значения нельзя додумывать.'
      : 'Переможця не визначаю: вибір залежить від ваших пріоритетів, а непідтверджені значення не можна додумувати.',
  ].join('\n');

  return result({
    mode: 'COMPARE',
    language,
    status: 'READY',
    products: matches,
    reasons: ['EXACT_PRODUCT_IDENTITIES_MATCHED', 'ONLY_CONFIRMED_FACTS_RENDERED'],
    answer,
    evidence,
  });
}

function buildRecommendation({ question, eligible, requestedConcepts, budget, language, limit }) {
  const ranked = eligible
    .map((product) => ({
      product,
      priceAmount: firstPriceAmount(product),
      facts: requestedConcepts.map((concept) => {
        const specification = findSpecification(product, concept.key);
        return { concept, specification };
      }),
      score: evidenceMatchScore(product, question),
    }))
    .filter((candidate) => budget === null
      || candidate.priceAmount !== null && candidate.priceAmount <= budget)
    .filter((candidate) => candidate.facts.every(({ specification }) => specification))
    .sort((left, right) => right.score - left.score || stableProductOrder(left.product, right.product))
    .slice(0, limit);

  if (ranked.length === 0) {
    return result({
      mode: 'RECOMMEND',
      language,
      status: 'INSUFFICIENT_EVIDENCE',
      reasons: [
        eligible.length === 0 ? 'NO_FRESH_PROVENANCED_PRODUCTS' : 'NO_PRODUCT_CONFIRMS_ALL_EXPLICIT_CONSTRAINTS',
      ],
      answer: language === 'ru'
        ? 'Недостаточно свежих подтверждённых данных, чтобы подобрать товар по всем указанным условиям.'
        : 'Недостатньо свіжих підтверджених даних, щоб підібрати товар за всіма вказаними умовами.',
    });
  }

  const selected = ranked.map(({ product }) => product);
  const fields = requestedConcepts.map((concept) => ({
    label: concept.labels[language],
    find: (product) => findSpecification(product, concept.key)?.value || null,
  }));
  const evidence = selected.map((product) => productEvidence(product, fields));
  const lines = evidence.map((item) => {
    const facts = [
      `${language === 'ru' ? 'цена' : 'ціна'} — ${item.price || unconfirmed(language)}`,
      ...item.facts.map((fact) => `${fact.label} — ${fact.value}`),
    ];
    return `- ${item.name}: ${facts.join('; ')}.`;
  });

  return result({
    mode: 'RECOMMEND',
    language,
    status: 'READY',
    products: selected,
    reasons: [
      'ONLY_FRESH_PROVENANCED_PRODUCTS',
      ...(budget === null ? [] : ['BUDGET_APPLIED_TO_CONFIRMED_PRICE']),
      ...(requestedConcepts.length === 0 ? [] : ['ALL_EXPLICIT_SPECIFICATION_CONSTRAINTS_CONFIRMED']),
    ],
    answer: [
      language === 'ru' ? 'Варианты по подтверждённым данным:' : 'Варіанти за підтвердженими даними:',
      ...lines,
    ].join('\n'),
    evidence,
  });
}

function result({
  mode,
  language,
  status,
  products = [],
  reasons = [],
  answer = null,
  evidence = [],
}) {
  return { mode, language, status, products, reasons, answer, evidence };
}

function detectMode(question) {
  const text = String(question || '');
  if (COMPARE_PATTERN.test(text)) return 'COMPARE';
  if (RECOMMEND_PATTERN.test(text)) return 'RECOMMEND';
  return 'NONE';
}

function detectLanguage(question) {
  const text = String(question || '');
  if (/[іїєґ]/iu.test(text)
    || /(?:порадьте|підбер|укажіть|точні|проектор\s+з|свіж|підтвердж)/iu.test(text)
    || !/[а-яё]/iu.test(text)) return 'uk';
  return 'ru';
}

function extractBudget(question) {
  const text = String(question || '').replace(/\u00a0/gu, ' ');
  const match = /(?:до|не\s+(?:дорожче|дороже)\s+(?:за)?|бюджет(?:ом)?\s*(?:до)?)[^\d]{0,12}(\d[\d\s.,]{0,12})\s*(?:грн\.?|₴|uah)/iu.exec(text);
  if (!match) return null;
  const amount = Number.parseFloat(match[1].replace(/\s+/gu, '').replace(',', '.'));
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

function hasRequiredEvidence(product) {
  return product
    && product.freshness === 'FRESH'
    && Number.isFinite(Date.parse(String(product.fetchedAt || '')))
    && Boolean(product.name)
    && Boolean(product.provenance?.source)
    && Boolean(product.provenance?.sourceId);
}

function exactIdentityMatch(product, question) {
  const haystack = normalizeIdentity(question);
  const aliases = [
    ...(Array.isArray(product?.aliases) ? product.aliases : []),
    product?.sku,
    product?.id,
    product?.name,
  ]
    .map(normalizeIdentity)
    .filter((value) => value.length >= 2)
    .sort((left, right) => right.length - left.length);
  return aliases.find((alias) => containsIdentity(haystack, alias)) || null;
}

function containsIdentity(haystack, alias) {
  if (!alias) return false;
  return ` ${haystack} `.includes(` ${alias} `);
}

function normalizeIdentity(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase('uk-UA')
    .replace(/ё/gu, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function evidenceMatchScore(product, question) {
  const tokens = [...new Set(normalizeIdentity(question).split(' ').filter((token) => token.length >= 3))];
  const evidenceText = normalizeIdentity([
    product.name,
    ...(Array.isArray(product.aliases) ? product.aliases : []),
    ...Object.entries(product.specifications || {}).flat(),
  ].join(' '));
  return tokens.reduce((score, token) => score + (containsIdentity(evidenceText, token) ? 1 : 0), 0);
}

function findSpecification(product, pattern) {
  const specifications = product?.specifications;
  if (!specifications || typeof specifications !== 'object' || Array.isArray(specifications)) return null;
  const entry = Object.entries(specifications)
    .sort(([left], [right]) => left.localeCompare(right, 'uk-UA'))
    .find(([key]) => pattern.test(key));
  return entry ? { key: entry[0], value: String(entry[1]) } : null;
}

function comparisonSpecificationFields(products) {
  const keys = [...new Set(products.flatMap((product) => Object.keys(product.specifications || {})))]
    .sort((left, right) => left.localeCompare(right, 'uk-UA'))
    .slice(0, 4);
  return keys.map((key) => ({
    label: key,
    find: (product) => product.specifications?.[key] || null,
  }));
}

function productEvidence(product, fields) {
  return {
    productId: product.id,
    name: product.name,
    price: Array.isArray(product.prices) ? product.prices[0] || null : null,
    facts: fields.map((field) => ({ label: field.label, value: field.find(product) })),
    provenance: product.provenance,
  };
}

function firstPriceAmount(product) {
  const price = Array.isArray(product?.prices) ? product.prices[0] : null;
  if (!price) return null;
  const match = /(\d[\d\s\u00a0.,]{0,12})\s*(?:грн\.?|₴|uah)/iu.exec(String(price));
  if (!match) return null;
  const amount = Number.parseFloat(match[1].replace(/[\s\u00a0]/gu, '').replace(',', '.'));
  return Number.isFinite(amount) ? amount : null;
}

function stableProductOrder(left, right) {
  return String(left?.name || '').localeCompare(String(right?.name || ''), 'uk-UA')
    || String(left?.id || '').localeCompare(String(right?.id || ''), 'uk-UA');
}

function unconfirmed(language) {
  return language === 'ru' ? 'не подтверждено' : 'не підтверджено';
}
