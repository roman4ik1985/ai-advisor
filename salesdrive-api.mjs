const DEFAULT_TIMEOUT_MS = 8_000;
const API_PATHS = Object.freeze({
  deliveryMethods: '/api/delivery-methods/',
  paymentMethods: '/api/payment-methods/',
  statuses: '/api/statuses/',
});

export function createSalesdriveApiClient({
  subdomain = process.env.SALESDRIVE_SUBDOMAIN,
  apiKey = process.env.SALESDRIVE_API_KEY,
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const normalizedSubdomain = normalizeSubdomain(subdomain);
  const configured = Boolean(normalizedSubdomain && String(apiKey || '').trim());

  async function listDeliveryMethods() {
    return listDictionary('deliveryMethods');
  }

  async function listPaymentMethods() {
    return listDictionary('paymentMethods');
  }

  async function listStatuses() {
    return listDictionary('statuses');
  }

  async function listDictionary(kind) {
    if (!configured) return unavailable('SALES_DRIVE_API_NOT_CONFIGURED');
    const path = API_PATHS[kind];
    if (!path) return unavailable('SALES_DRIVE_API_ENDPOINT_BLOCKED');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`https://${normalizedSubdomain}.salesdrive.me${path}`, {
        method: 'GET',
        redirect: 'error',
        headers: { Accept: 'application/json', 'X-Api-Key': String(apiKey).trim() },
        signal: controller.signal,
      });
      if (!response?.ok) return unavailable('SALES_DRIVE_API_UNAVAILABLE');
      const payload = await response.json();
      const items = Array.isArray(payload?.data) ? payload.data.map(normalizeDictionaryItem).filter(Boolean) : [];
      return {
        items,
        diagnostics: { code: items.length ? 'OK' : 'EMPTY_RESULTS', source: 'salesdrive_api' },
        source: 'salesdrive_api',
        fetchedAt: now().toISOString(),
        freshness: 'FRESH',
      };
    } catch (error) {
      return unavailable(error?.name === 'AbortError' ? 'SALES_DRIVE_API_TIMEOUT' : 'SALES_DRIVE_API_UNAVAILABLE');
    } finally {
      clearTimeout(timer);
    }
  }

  return { configured, listDeliveryMethods, listPaymentMethods, listStatuses };
}

function normalizeDictionaryItem(item) {
  if (!item || typeof item !== 'object') return null;
  const id = item.id ?? item.value ?? null;
  const label = String(item.name ?? item.title ?? item.label ?? '').trim();
  return id === null || !label ? null : { id: String(id), label };
}

function normalizeSubdomain(value) {
  const normalized = String(value || '').trim().toLowerCase().replace(/\.salesdrive\.me$/u, '');
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(normalized) ? normalized : null;
}

function unavailable(code) {
  return {
    items: [],
    diagnostics: { code, source: 'salesdrive_api' },
    source: 'salesdrive_api',
    fetchedAt: null,
    freshness: 'UNAVAILABLE',
  };
}
