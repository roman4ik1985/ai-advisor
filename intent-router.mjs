const KNOWLEDGE_MAX_AGE_DAYS = 180;

const ROUTES = Object.freeze({
  store_faq: Object.freeze({ catalog: false, knowledge: true }),
  product_lookup: Object.freeze({ catalog: true, knowledge: true }),
  product_advice: Object.freeze({ catalog: true, knowledge: true }),
  live_fact: Object.freeze({ catalog: true, knowledge: false }),
  manager_handoff: Object.freeze({ catalog: false, knowledge: true }),
});

const ESCALATION_PATTERN = /(?:менеджер|менеджеру|оператор|перезвон|зателефон|подзвон|контакт|телефон|скарг|жалоб|повернен|возврат|юридич|суд|претенз)/u;
const PRICE_PATTERN = /(?:(?:^|[^\p{L}])(?:ціна|ціни|ціну|ціною|ціні|цена|цены|цену|цене|ценой)(?=$|[^\p{L}])|стоимост|скільки кошту|сколько стоит)/u;
const LIVE_PATTERN = /(?:наявност|наличи|в наличии|есть ли|доступн|сьогодні|сегодня|завтра|післязавтра|послезавтра|коли достав|когда достав|строк.*достав|срок.*достав)/u;
const DELIVERY_PATTERN = /(?:доставк|доставлен|доставим|доставимо|відправк|відправлен|отправим|відправимо|самовивіз|самовывоз)/u;
const EXPLICIT_INVENTORY_PATTERN = /(?:наявност|наличи|в наличии|есть ли|залиш|остатк|резерв)/u;
const AVAILABILITY_PATTERN = /(?:доступн)/u;
const DELIVERY_METHODS_PATTERN = /(?:(?:способ|варіант|вариант|метод)\w*.{0,32}(?:доставк|доставлен)|(?:доставк|доставлен)\w*.{0,32}(?:способ|варіант|вариант|метод))/u;
const PAYMENT_METHODS_PATTERN = /(?:(?:способ|варіант|вариант|метод)\w*.{0,32}(?:оплат|платеж|платіж)|(?:оплат|платеж|платіж)\w*.{0,32}(?:способ|варіант|вариант|метод)|(?:як|как)\s+(?:можна|можно)\s+оплат)/u;
const FINANCING_POLICY_PATTERN = /(?:рассроч|розстроч|кредит|оплат\w*.{0,16}част)/u;
const ADVICE_PATTERN = /(?:подбер|порад|порекоменду|посовет|какой.*выбрать|який.*обрат|какой.*підібрат|для дома|для кімнат|для комнаты|бюджет|яркост|яскравіст)/u;
const COMPATIBILITY_PATTERN = /(?:сумісн|совместим|підійде|подойдет|підходить|подходит|екран|screen|ps5|playstation|xbox)/u;

export function classifyIntent({ question = '', messages = [] } = {}) {
  const text = normalize(question || latestUserMessage(messages));

  if (ESCALATION_PATTERN.test(text)) return 'manager_handoff';
  if (FINANCING_POLICY_PATTERN.test(text)) return 'store_faq';
  if (PAYMENT_METHODS_PATTERN.test(text) || DELIVERY_METHODS_PATTERN.test(text)) return 'store_faq';
  if (LIVE_PATTERN.test(text) || PRICE_PATTERN.test(text)) return 'live_fact';
  if (/(?:гарант|оплат|рассроч|кредит|повернен|обмен)/u.test(text)) return 'store_faq';
  if (ADVICE_PATTERN.test(text)) return 'product_advice';
  return 'product_lookup';
}

export function getRoutePolicy(intent) {
  return ROUTES[intent] || ROUTES.product_lookup;
}

export function buildRouteDecision({ question = '', messages = [] } = {}) {
  const normalizedQuestion = normalize(question || latestUserMessage(messages));
  const intent = classifyIntent({ question: normalizedQuestion, messages });
  const isRecommendation = ADVICE_PATTERN.test(normalizedQuestion);
  const needsDelivery = DELIVERY_PATTERN.test(normalizedQuestion);
  const needsPrice = PRICE_PATTERN.test(normalizedQuestion);
  const deliveryMethodsOnly = needsDelivery && DELIVERY_METHODS_PATTERN.test(normalizedQuestion);
  const needsPayment = PAYMENT_METHODS_PATTERN.test(normalizedQuestion);
  const financingPolicyOnly = FINANCING_POLICY_PATTERN.test(normalizedQuestion);
  const needsInventory = EXPLICIT_INVENTORY_PATTERN.test(normalizedQuestion)
    || AVAILABILITY_PATTERN.test(normalizedQuestion) && !deliveryMethodsOnly && !needsPayment && !financingPolicyOnly;
  const needsCompatibility = COMPATIBILITY_PATTERN.test(normalizedQuestion);
  const hasMultipleCommercialConstraints = [needsInventory, needsDelivery, needsPrice, needsPayment, needsCompatibility]
    .filter(Boolean)
    .length >= 2;

  let route = 'SIMPLE';
  if (intent === 'manager_handoff') route = 'ESCALATE';
  else if (isRecommendation && (hasMultipleCommercialConstraints || (needsCompatibility && (needsInventory || needsDelivery)))) route = 'COMPLEX';
  else if (intent === 'live_fact' || intent === 'product_advice') route = 'STANDARD';

  const requiredResolvers = new Set();
  const policy = getRoutePolicy(intent);
  const methodInformationOnly = (needsPayment || deliveryMethodsOnly)
    && (!needsDelivery || deliveryMethodsOnly)
    && !needsInventory
    && !needsPrice;
  if (policy.catalog && !methodInformationOnly) requiredResolvers.add('catalog');
  if (policy.knowledge) requiredResolvers.add('knowledge');
  if (route === 'COMPLEX') requiredResolvers.add('knowledge');
  if (needsPrice) requiredResolvers.add('price');
  if (needsInventory) requiredResolvers.add('inventory');
  if (needsDelivery && !methodInformationOnly) requiredResolvers.add('delivery');
  if (needsPayment && !methodInformationOnly) requiredResolvers.add('payment');

  return {
    route,
    intent,
    riskLevel: route === 'ESCALATE' ? 'high' : route === 'COMPLEX' || intent === 'live_fact' ? 'medium' : 'low',
    productId: null,
    requiredResolvers: [...requiredResolvers],
    requiresVerification: route === 'COMPLEX',
  };
}

export function buildFreshnessEvidence({ intent, catalogDiagnostics, knowledge = [], liveEvidence = {}, now = () => new Date() } = {}) {
  const policy = getRoutePolicy(intent);
  const checkedAt = now().toISOString();
  const reviewedAt = [...new Set((Array.isArray(knowledge) ? knowledge : [])
    .map((entry) => String(entry?.reviewedAt || '').trim())
    .filter(Boolean))];

  return {
    catalog: {
      queried: policy.catalog,
      fetchedAt: policy.catalog ? checkedAt : null,
      code: String(catalogDiagnostics?.code || (policy.catalog ? 'UNKNOWN' : 'SKIPPED_BY_ROUTE')),
    },
    knowledge: {
      queried: policy.knowledge,
      reviewedAt,
      maxAgeDays: KNOWLEDGE_MAX_AGE_DAYS,
    },
    live: liveEvidence,
  };
}

export function routeInstruction(intent) {
  switch (intent) {
    case 'store_faq':
      return 'TRUSTED_ROUTE_POLICY: This is a store-policy FAQ. Use only supplied knowledge evidence; do not imply a catalog lookup happened.';
    case 'product_advice':
      return 'TRUSTED_ROUTE_POLICY: This is a product-selection request. Use supplied catalog and knowledge evidence, or ask one focused clarification when needed.';
    case 'live_fact':
      return 'TRUSTED_ROUTE_POLICY: This asks for a live fact. Catalog cards may support current price and product identity only. Payment and delivery method labels require explicit live dictionary evidence. Do not claim stock, reservation, delivery deadline, payment approval, promotion, or any other live operational fact without explicit evidence; recommend manager confirmation when needed.';
    case 'manager_handoff':
      return 'TRUSTED_ROUTE_POLICY: The visitor explicitly needs a manager. Do not guess contact, stock, payment, or delivery details; explain what the manager should confirm.';
    default:
      return 'TRUSTED_ROUTE_POLICY: This is a product lookup. Use supplied catalog and knowledge evidence only.';
  }
}

function latestUserMessage(messages) {
  return [...(Array.isArray(messages) ? messages : [])]
    .reverse()
    .find((item) => item?.role === 'user')?.content || '';
}

function normalize(value) {
  return String(value || '').toLowerCase().replace(/ё/gu, 'е').replace(/\s+/gu, ' ').trim();
}
