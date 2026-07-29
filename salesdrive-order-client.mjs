import { assessOrderOwnershipProof } from './order-ownership-contract.mjs';
import { toPublicOrderDto } from './order-dto.mjs';

const ORDER_LIST_PATH = '/api/order/list/';
const DEFAULT_TIMEOUT_MS = 8_000;
const SOURCE_ORDER_ID = /^[1-9]\d{0,18}$/u;
const CUSTOMER_REF = /^salesdrive:counterparty:([1-9]\d{0,18})$/u;

export const SALESDRIVE_ORDER_SOURCE_CONTRACT = Object.freeze({
  endpoint: ORDER_LIST_PATH,
  method: 'GET',
  maximumRawOrdersPerLookup: 2,
  ownershipField: 'primaryContact.counterpartyId or contacts[].counterpartyId',
  publicFailureCode: 'ORDER_NOT_AVAILABLE',
});

export function createSalesdriveOrderClient({
  subdomain = process.env.SALESDRIVE_SUBDOMAIN,
  apiKey = process.env.SALESDRIVE_API_KEY,
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
  timeoutMs = DEFAULT_TIMEOUT_MS,
  labels = {},
} = {}) {
  const normalizedSubdomain = normalizeSubdomain(subdomain);
  const normalizedApiKey = String(apiKey ?? '').trim();
  const configured = Boolean(normalizedSubdomain && normalizedApiKey && typeof fetchImpl === 'function');

  async function getOwnedOrder({
    sourceOrderId,
    binding,
    ownershipProof,
  } = {}) {
    const nowDate = now();
    const nowMs = nowDate instanceof Date ? nowDate.getTime() : Number.NaN;
    if (!configured) return unavailable('SALES_DRIVE_API_NOT_CONFIGURED');
    if (!SOURCE_ORDER_ID.test(String(sourceOrderId ?? ''))) return unavailable();
    if (!validBinding(binding)) return unavailable();
    if (!assessOrderOwnershipProof(ownershipProof, { now: nowMs }).canLookupOrder) return unavailable();

    const url = new URL(`https://${normalizedSubdomain}.salesdrive.me${ORDER_LIST_PATH}`);
    url.searchParams.set('filter[id][from]', String(sourceOrderId));
    url.searchParams.set('filter[id][to]', String(sourceOrderId));
    url.searchParams.set('page', '1');
    url.searchParams.set('limit', '2');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        method: 'GET',
        redirect: 'error',
        headers: {
          Accept: 'application/json',
          'X-Api-Key': normalizedApiKey,
        },
        signal: controller.signal,
      });
      if (!response?.ok) return unavailable('SALES_DRIVE_API_UNAVAILABLE');

      const payload = await response.json();
      const rawOrders = Array.isArray(payload?.data) ? payload.data.slice(0, 2) : [];
      const rawOrder = rawOrders.length === 1 ? rawOrders[0] : null;
      if (!isOwnedByBinding(rawOrder, binding)) return unavailable();

      const order = toPublicOrderDto(rawOrder, {
        fetchedAt: nowDate.toISOString(),
        statusLabels: labels.statuses,
        paymentMethodLabels: labels.paymentMethods,
        deliveryMethodLabels: labels.deliveryMethods,
      });
      return order
        ? { ok: true, code: 'ORDER_AVAILABLE', order }
        : unavailable('ORDER_DATA_INCOMPLETE');
    } catch (error) {
      return unavailable(error?.name === 'AbortError'
        ? 'SALES_DRIVE_API_TIMEOUT'
        : 'SALES_DRIVE_API_UNAVAILABLE');
    } finally {
      clearTimeout(timer);
    }
  }

  return Object.freeze({ configured, getOwnedOrder });
}

function isOwnedByBinding(rawOrder, binding) {
  if (!rawOrder || typeof rawOrder !== 'object') return false;
  const match = CUSTOMER_REF.exec(String(binding.customerRef ?? ''));
  if (!match) return false;
  const expected = match[1];
  const contacts = [
    rawOrder.primaryContact,
    ...(Array.isArray(rawOrder.contacts) ? rawOrder.contacts : []),
  ];
  return contacts.some((contact) => (
    contact && String(contact.counterpartyId ?? '') === expected
  ));
}

function validBinding(binding) {
  return binding
    && binding.channel === 'TELEGRAM_REQUEST_CONTACT'
    && /^[1-9]\d{0,19}$/u.test(String(binding.telegramUserId ?? ''))
    && CUSTOMER_REF.test(String(binding.customerRef ?? ''));
}

function normalizeSubdomain(value) {
  const normalized = String(value ?? '').trim().toLowerCase().replace(/\.salesdrive\.me$/u, '');
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(normalized) ? normalized : null;
}

function unavailable(diagnosticCode = 'ORDER_NOT_AVAILABLE') {
  return Object.freeze({
    ok: false,
    code: 'ORDER_NOT_AVAILABLE',
    order: null,
    diagnosticCode,
  });
}
