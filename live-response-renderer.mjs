export function renderDeterministicLiveAnswer({
  question = '',
  route = {},
  catalog = [],
  liveFacts = {},
  liveEvidence = {},
} = {}) {
  const resolvers = new Set(route?.requiredResolvers || []);
  if (resolvers.has('delivery')) {
    if (!isFreshAvailable(liveEvidence.delivery, 'methods')) return null;
    if (asksForDeliveryDeadline(question)) return null;
    return renderDeliveryMethods(question, liveFacts.deliveryMethods);
  }
  if (resolvers.has('inventory')) {
    if (!isFreshAvailable(liveEvidence.inventory, 'stock')) return null;
    if (resolvers.has('price') && !isFreshAvailable(liveEvidence.price)) return null;
    return renderInventory(question, catalog, liveFacts.inventory, resolvers.has('price'));
  }
  if (resolvers.has('price')) {
    if (!isFreshAvailable(liveEvidence.price)) return null;
    return renderPrice(question, catalog);
  }
  return null;
}

function isFreshAvailable(evidence, capability) {
  const available = evidence?.status === 'AVAILABLE' && evidence?.freshness === 'FRESH';
  return available && (!capability || Array.isArray(evidence?.capabilities) && evidence.capabilities.includes(capability));
}

function renderDeliveryMethods(question, methods) {
  const labels = [...new Set((Array.isArray(methods) ? methods : [])
    .map((item) => String(item?.label || '').trim())
    .filter(Boolean))]
    .slice(0, 12);
  if (labels.length === 0) return null;
  return isUkrainian(question)
    ? `Доступні способи доставки: ${labels.join(', ')}. Точний строк доставки уточнить менеджер.`
    : `Доступные способы доставки: ${labels.join(', ')}. Точный срок доставки уточнит менеджер.`;
}

function renderInventory(question, catalog, inventory, includePrice) {
  const candidates = (Array.isArray(catalog) ? catalog : []).filter((product) => {
    const sku = String(product?.sku || '');
    return sku && (Array.isArray(inventory) ? inventory : []).some((fact) => String(fact?.sku || '') === sku);
  });
  const item = selectConfidentProduct(question, candidates);
  if (!item && candidates.length > 1) return ambiguityFallback(question);
  const state = item?.availability?.state;
  if (!item || !['IN_STOCK', 'OUT_OF_STOCK'].includes(state)) return null;

  const rawPrice = includePrice && Array.isArray(item.prices) ? String(item.prices[0] || '').trim() : '';
  const price = rawPrice ? ` ${isUkrainian(question) ? 'Ціна' : 'Цена'}: ${rawPrice.replace(/\.+$/u, '')}.` : '';
  if (isUkrainian(question)) {
    const availability = state === 'IN_STOCK' ? 'є в наявності' : 'немає в наявності';
    return `За даними SalesDrive, ${item.name}: ${availability}.${price}`;
  }
  const availability = state === 'IN_STOCK' ? 'есть в наличии' : 'нет в наличии';
  return `По данным SalesDrive, ${item.name}: ${availability}.${price}`;
}

function renderPrice(question, catalog) {
  const candidates = (Array.isArray(catalog) ? catalog : []).filter((item) => Array.isArray(item?.prices) && item.prices[0]);
  const item = selectConfidentProduct(question, candidates);
  if (!item && candidates.length > 1) return ambiguityFallback(question);
  if (!item) return null;
  const price = String(item.prices[0]).trim().replace(/\.+$/u, '');
  return isUkrainian(question)
    ? `За даними SalesDrive, ціна ${item.name}: ${price}.`
    : `По данным SalesDrive, цена ${item.name}: ${price}.`;
}

function selectConfidentProduct(question, candidates) {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];
  const query = compact(question);
  const matches = candidates.map((item) => {
    const sku = compact(item?.sku);
    const name = compact(item?.name);
    const score = Math.max(
      sku.length >= 3 && query.includes(sku) ? sku.length : 0,
      name.length >= 5 && query.includes(name) ? name.length : 0,
    );
    return { item, score };
  }).filter((match) => match.score > 0).sort((left, right) => right.score - left.score);
  if (matches.length === 0) return null;
  return matches.length === 1 || matches[0].score > matches[1].score ? matches[0].item : null;
}

function compact(value) {
  return String(value || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

function ambiguityFallback(question) {
  return isUkrainian(question)
    ? 'Уточніть, будь ласка, модель або артикул проектора — перевірю точну ціну та наявність.'
    : 'Уточните, пожалуйста, модель или артикул проектора — проверю точную цену и наличие.';
}

function isUkrainian(question) {
  const text = String(question || '');
  return /[іїєґ]/iu.test(text) || !/[а-яё]/iu.test(text);
}

function asksForDeliveryDeadline(question) {
  return /(?:сьогодні|сегодня|завтра|післязавтра|послезавтра|коли достав|когда достав|строк.*достав|срок.*достав|\d+\s*(?:дн\w*|день\w*|годин\w*|час\w*))/iu.test(String(question || ''));
}
