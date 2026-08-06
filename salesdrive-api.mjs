import { appendFile } from 'node:fs/promises';
import { join } from 'node:path';

const DEFAULT_TIMEOUT_MS = 8_000;
const DIAGNOSTIC_LOG_FILE = 'ai-advisor-salesdrive-diagnostics.jsonl';
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
  logger = console,
  diagnosticWriter = appendSalesdriveDiagnostic,
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
    if (!configured) return reportUnavailable(kind, 'SALES_DRIVE_API_NOT_CONFIGURED');
    const path = API_PATHS[kind];
    if (!path) return reportUnavailable(kind, 'SALES_DRIVE_API_ENDPOINT_BLOCKED');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`https://${normalizedSubdomain}.salesdrive.me${path}`, {
        method: 'GET',
        redirect: 'error',
        headers: { Accept: 'application/json', 'X-Api-Key': String(apiKey).trim() },
        signal: controller.signal,
      });
      if (!response?.ok) {
        return reportUnavailable(kind, 'SALES_DRIVE_API_HTTP_ERROR', {
          httpStatus: normalizeHttpStatus(response?.status),
        });
      }
      const payload = await response.json();
      const items = Array.isArray(payload?.data) ? payload.data.map(normalizeDictionaryItem).filter(Boolean) : [];
      const result = {
        items,
        diagnostics: { code: items.length ? 'OK' : 'EMPTY_RESULTS', source: 'salesdrive_api', dictionary: kind },
        source: 'salesdrive_api',
        fetchedAt: now().toISOString(),
        freshness: 'FRESH',
      };
      if (!items.length) {
        warnDiagnostic(logger, result.diagnostics);
        await writeDiagnostic({
          timestamp: now().toISOString(),
          dictionary: kind,
          code: 'EMPTY_RESULTS',
          httpStatus: null,
        });
      }
      return result;
    } catch (error) {
      return reportUnavailable(
        kind,
        error?.name === 'AbortError' ? 'SALES_DRIVE_API_TIMEOUT' : 'SALES_DRIVE_API_UNAVAILABLE',
      );
    } finally {
      clearTimeout(timer);
    }
  }

  async function reportUnavailable(kind, code, details = {}) {
    const result = unavailable(code, { dictionary: kind, ...details });
    warnDiagnostic(logger, result.diagnostics);
    await writeDiagnostic({
      timestamp: now().toISOString(),
      dictionary: kind,
      code,
      httpStatus: result.diagnostics.httpStatus ?? null,
    });
    return result;
  }

  async function writeDiagnostic(record) {
    try {
      await diagnosticWriter(record);
    } catch {
      // Diagnostics must not weaken the fail-closed resolver path.
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

function unavailable(code, details = {}) {
  return {
    items: [],
    diagnostics: { code, source: 'salesdrive_api', ...details },
    source: 'salesdrive_api',
    fetchedAt: null,
    freshness: 'UNAVAILABLE',
  };
}

function normalizeHttpStatus(value) {
  const status = Number(value);
  return Number.isInteger(status) && status >= 100 && status <= 599 ? status : null;
}

function warnDiagnostic(logger, diagnostics) {
  if (typeof logger?.warn !== 'function') return;
  const status = diagnostics.httpStatus === null || diagnostics.httpStatus === undefined
    ? 'NONE'
    : diagnostics.httpStatus;
  logger.warn(`[salesdrive-api] dictionary=${diagnostics.dictionary} code=${diagnostics.code} status=${status}`);
}

async function appendSalesdriveDiagnostic(record) {
  const logPath = join(process.cwd(), 'logs', DIAGNOSTIC_LOG_FILE);
  await appendFile(logPath, `${JSON.stringify(record)}\n`, 'utf8');
}
