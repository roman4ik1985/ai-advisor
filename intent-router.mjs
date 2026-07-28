const KNOWLEDGE_MAX_AGE_DAYS = 180;

const ROUTES = Object.freeze({
  store_faq: Object.freeze({ catalog: false, knowledge: true }),
  product_lookup: Object.freeze({ catalog: true, knowledge: true }),
  product_advice: Object.freeze({ catalog: true, knowledge: true }),
  live_fact: Object.freeze({ catalog: true, knowledge: false }),
  manager_handoff: Object.freeze({ catalog: false, knowledge: true }),
});

export function classifyIntent({ question = '', messages = [] } = {}) {
  const text = normalize(question || latestUserMessage(messages));

  if (/(?:менеджер|менеджеру|оператор|перезвон|зателефон|подзвон|контакт|телефон)/u.test(text)) return 'manager_handoff';
  if (/(?:наявност|наличи|в наличии|есть ли|доступн|сегодня|сегодня|завтра|послезавтра|когда достав|срок.*достав)/u.test(text)) return 'live_fact';
  if (/(?:гарант|оплат|рассроч|кредит|возврат|обмен|доставк|самовывоз|повернен)/u.test(text)) return 'store_faq';
  if (/(?:подбер|порекоменду|посовет|какой.*выбрать|какой.*підібрат|для дома|для кімнат|для комнаты|бюджет|яркост|яскравіст)/u.test(text)) return 'product_advice';
  return 'product_lookup';
}

export function getRoutePolicy(intent) {
  return ROUTES[intent] || ROUTES.product_lookup;
}

export function buildFreshnessEvidence({ intent, catalogDiagnostics, knowledge = [], now = () => new Date() } = {}) {
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
  };
}

export function routeInstruction(intent) {
  switch (intent) {
    case 'store_faq':
      return 'TRUSTED_ROUTE_POLICY: This is a store-policy FAQ. Use only supplied knowledge evidence; do not imply a catalog lookup happened.';
    case 'product_advice':
      return 'TRUSTED_ROUTE_POLICY: This is a product-selection request. Use supplied catalog and knowledge evidence, or ask one focused clarification when needed.';
    case 'live_fact':
      return 'TRUSTED_ROUTE_POLICY: This asks for a live fact. Catalog cards may support current price and product identity only. Do not claim stock, reservation, delivery deadline, promotion, or any other live operational fact without explicit evidence; recommend manager confirmation when needed.';
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
