import { normalizeUaPhone } from './telegram-order-binding.mjs';

const ORDER_PATH = '/api/order/list/';
const ORDER_REFERENCE = /^[A-Za-z0-9._/-]{1,64}$/u;

export function createSalesdriveOrderProvisioningResolver({
  subdomain = process.env.SALESDRIVE_SUBDOMAIN,
  apiKey = process.env.SALESDRIVE_API_KEY,
  fetchImpl = globalThis.fetch,
  timeoutMs = 8_000,
} = {}) {
  const host = normalizeSubdomain(subdomain);
  const key = String(apiKey ?? '').trim();
  const configured = Boolean(host && key && typeof fetchImpl === 'function');

  async function resolveCandidate(orderReference) {
    const reference = String(orderReference ?? '').trim();
    if (!configured || !ORDER_REFERENCE.test(reference)) return null;
    const url = new URL(`https://${host}.salesdrive.me${ORDER_PATH}`);
    url.searchParams.set('filter[externalId]', reference);
    url.searchParams.set('page', '1');
    url.searchParams.set('limit', '2');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        method: 'GET',
        redirect: 'error',
        headers: { Accept: 'application/json', 'X-Api-Key': key },
        signal: controller.signal,
      });
      if (!response?.ok) return null;
      const payload = await response.json();
      const matches = (Array.isArray(payload?.data) ? payload.data : [])
        .filter((order) => String(order?.externalId ?? '') === reference)
        .slice(0, 2);
      if (matches.length !== 1) return null;
      const order = matches[0];
      const sourceOrderId = String(order?.id ?? '');
      const counterpartyId = String(order?.primaryContact?.counterpartyId ?? '');
      const expectedPhone = (Array.isArray(order?.primaryContact?.phone)
        ? order.primaryContact.phone
        : [order?.primaryContact?.phone])
        .map(normalizeUaPhone)
        .find(Boolean);
      if (
        !/^[1-9]\d{0,18}$/u.test(sourceOrderId)
        || !/^[1-9]\d{0,18}$/u.test(counterpartyId)
        || !expectedPhone
      ) return null;
      return Object.freeze({
        customerRef: `salesdrive:counterparty:${counterpartyId}`,
        expectedPhone,
        sourceOrderIds: Object.freeze([sourceOrderId]),
      });
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  return Object.freeze({ configured, resolveCandidate });
}

function normalizeSubdomain(value) {
  const normalized = String(value ?? '').trim().toLowerCase().replace(/\.salesdrive\.me$/u, '');
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(normalized) ? normalized : null;
}
