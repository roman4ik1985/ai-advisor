export function renderDeterministicLiveAnswer({ question = '', route = {}, catalog = [], liveFacts = {} } = {}) {
  const resolvers = new Set(route?.requiredResolvers || []);
  if (resolvers.has('delivery')) {
    if (asksForDeliveryDeadline(question)) return null;
    return renderDeliveryMethods(question, liveFacts.deliveryMethods);
  }
  if (resolvers.has('inventory')) return renderInventory(question, catalog, liveFacts.inventory, resolvers.has('price'));
  return null;
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
  const item = (Array.isArray(catalog) ? catalog : []).find((product) => {
    const sku = String(product?.sku || '');
    return sku && (Array.isArray(inventory) ? inventory : []).some((fact) => String(fact?.sku || '') === sku);
  });
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

function isUkrainian(question) {
  const text = String(question || '');
  return /[іїєґ]/iu.test(text) || !/[а-яё]/iu.test(text);
}

function asksForDeliveryDeadline(question) {
  return /(?:сьогодні|сегодня|завтра|післязавтра|послезавтра|коли достав|когда достав|строк.*достав|срок.*достав|\d+\s*(?:дн\w*|день\w*|годин\w*|час\w*))/iu.test(String(question || ''));
}
