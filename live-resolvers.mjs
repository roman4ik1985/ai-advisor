import { enrichProductsWithSpecificationEvidence } from './product-specification-evidence.mjs';

function unavailableResolver(reason) {
  return {
    status: 'UNAVAILABLE',
    freshness: 'UNAVAILABLE',
    source: null,
    checkedAt: null,
    reason,
  };
}

function notRequiredResolver() {
  return {
    status: 'NOT_REQUIRED',
    freshness: null,
    source: null,
    checkedAt: null,
    reason: null,
  };
}

export async function resolveLiveEvidence({
  route,
  question = '',
  queryCatalog,
  querySalesdriveCatalog,
  querySalesdriveDelivery,
  querySalesdrivePayment,
  productSpecificationEvidence = [],
  now = () => new Date(),
}) {
  const requiredResolvers = new Set(route?.requiredResolvers || []);
  let catalog = [];
  let catalogDiagnostics = {
    code: 'SKIPPED_BY_ROUTE',
    message: 'Catalog lookup skipped because this route does not require it.',
  };
  let catalogResolver = notRequiredResolver();
  let priceResolver = notRequiredResolver();
  let inventoryResolver = notRequiredResolver();
  let deliveryResolver = notRequiredResolver();
  let paymentResolver = notRequiredResolver();
  const liveFacts = {};

  if (requiredResolvers.has('catalog') || requiredResolvers.has('price')) {
    let result = querySalesdriveCatalog
      ? await querySalesdriveCatalog(question)
      : await queryCatalog();
    if (
      route?.intent === 'product_advice'
      && querySalesdriveCatalog
      && normalizeFreshness(result) === 'FRESH'
      && (!Array.isArray(result?.products) || result.products.length === 0)
    ) {
      const broadResult = await querySalesdriveCatalog('');
      if (normalizeFreshness(broadResult) === 'FRESH' && Array.isArray(broadResult?.products) && broadResult.products.length > 0) {
        result = {
          ...broadResult,
          diagnostics: {
            ...(broadResult.diagnostics || {}),
            code: 'OK',
            strategy: 'BROAD_PRODUCT_ADVICE',
          },
        };
      }
    }
    const resultFreshness = normalizeFreshness(result);
    const rawCatalog = Array.isArray(result?.products) ? result.products : [];
    const isFresh = resultFreshness === 'FRESH';
    catalog = isFresh
      ? enrichProductsWithSpecificationEvidence(rawCatalog, productSpecificationEvidence)
      : [];
    catalogDiagnostics = {
      ...(result?.diagnostics || { code: 'UNKNOWN' }),
      freshness: resultFreshness,
    };
    const checkedAt = now().toISOString();
    const source = result?.source || 'public_catalog_search';
    const fetchedAt = result?.fetchedAt || checkedAt;
    const hasProducts = isFresh && catalog.length > 0 && catalogDiagnostics.code === 'OK';
    catalogResolver = {
      status: hasProducts ? 'AVAILABLE' : resolverFailureStatus(resultFreshness),
      freshness: resultFreshness,
      source: hasProducts || resultFreshness === 'STALE' ? source : null,
      checkedAt: hasProducts || resultFreshness === 'STALE' ? fetchedAt : null,
      reason: hasProducts ? null : catalogDiagnostics.code,
    };
    if (requiredResolvers.has('price')) {
      const hasPrice = catalog.some((product) => Array.isArray(product?.prices) && product.prices.length > 0);
      priceResolver = {
        status: hasPrice ? 'AVAILABLE' : resolverFailureStatus(resultFreshness),
        freshness: resultFreshness,
        source: hasPrice || resultFreshness === 'STALE' ? source : null,
        checkedAt: hasPrice || resultFreshness === 'STALE' ? fetchedAt : null,
        reason: hasPrice ? null : catalogDiagnostics.code,
      };
    }
    if (requiredResolvers.has('inventory')) {
      const inventoryProducts = catalog.filter((product) => ['IN_STOCK', 'OUT_OF_STOCK'].includes(product?.availability?.state));
      inventoryResolver = {
        status: inventoryProducts.length > 0 ? 'AVAILABLE' : resolverFailureStatus(resultFreshness),
        freshness: resultFreshness,
        source: inventoryProducts.length > 0 || resultFreshness === 'STALE' ? source : null,
        checkedAt: inventoryProducts.length > 0 || resultFreshness === 'STALE' ? fetchedAt : null,
        reason: inventoryProducts.length > 0
          ? null
          : resultFreshness === 'FRESH' ? 'SALES_DRIVE_STOCK_NOT_PRESENT' : catalogDiagnostics.code,
        capabilities: inventoryProducts.length > 0 ? ['stock'] : [],
      };
      if (inventoryProducts.length > 0) liveFacts.inventory = inventoryProducts.map((product) => ({
        sku: product.sku,
        name: product.name,
        availability: product.availability,
      }));
    }
  }

  if (requiredResolvers.has('delivery')) {
    const result = querySalesdriveDelivery
      ? await querySalesdriveDelivery()
      : { items: [], diagnostics: { code: 'NO_AUTHORIZED_READ_ONLY_SOURCE' }, fetchedAt: null };
    const items = Array.isArray(result?.items) ? result.items : [];
    const resultFreshness = normalizeFreshness(result);
    const hasDeliveryMethods = resultFreshness === 'FRESH' && items.length > 0 && result?.diagnostics?.code === 'OK';
    deliveryResolver = {
      status: hasDeliveryMethods ? 'AVAILABLE' : resolverFailureStatus(resultFreshness),
      freshness: resultFreshness,
      source: hasDeliveryMethods || resultFreshness === 'STALE' ? (result?.source || 'salesdrive_api') : null,
      checkedAt: hasDeliveryMethods || resultFreshness === 'STALE' ? (result?.fetchedAt || now().toISOString()) : null,
      reason: hasDeliveryMethods ? null : String(result?.diagnostics?.code || 'SALES_DRIVE_API_UNAVAILABLE'),
      capabilities: hasDeliveryMethods ? ['methods'] : [],
    };
    if (hasDeliveryMethods) liveFacts.deliveryMethods = items;
  }

  if (requiredResolvers.has('payment')) {
    const result = querySalesdrivePayment
      ? await querySalesdrivePayment()
      : { items: [], diagnostics: { code: 'NO_AUTHORIZED_READ_ONLY_SOURCE' }, fetchedAt: null };
    const items = Array.isArray(result?.items) ? result.items : [];
    const resultFreshness = normalizeFreshness(result);
    const hasPaymentMethods = resultFreshness === 'FRESH' && items.length > 0 && result?.diagnostics?.code === 'OK';
    paymentResolver = {
      status: hasPaymentMethods ? 'AVAILABLE' : resolverFailureStatus(resultFreshness),
      freshness: resultFreshness,
      source: hasPaymentMethods || resultFreshness === 'STALE' ? (result?.source || 'salesdrive_api') : null,
      checkedAt: hasPaymentMethods || resultFreshness === 'STALE' ? (result?.fetchedAt || now().toISOString()) : null,
      reason: hasPaymentMethods ? null : String(result?.diagnostics?.code || 'SALES_DRIVE_API_UNAVAILABLE'),
      capabilities: hasPaymentMethods ? ['methods'] : [],
    };
    if (hasPaymentMethods) liveFacts.paymentMethods = items;
  }

  return {
    catalog,
    catalogDiagnostics,
    evidence: {
      catalog: catalogResolver,
      price: priceResolver,
      inventory: requiredResolvers.has('inventory') ? inventoryResolver : notRequiredResolver(),
      delivery: requiredResolvers.has('delivery') ? deliveryResolver : notRequiredResolver(),
      payment: requiredResolvers.has('payment') ? paymentResolver : notRequiredResolver(),
    },
    liveFacts,
  };
}

function normalizeFreshness(result) {
  const explicit = String(result?.freshness || '').toUpperCase();
  if (['FRESH', 'STALE', 'UNAVAILABLE'].includes(explicit)) return explicit;
  if (result?.diagnostics?.code === 'STALE_LAST_KNOWN_GOOD') return 'STALE';
  return result?.diagnostics?.code === 'OK' ? 'FRESH' : 'UNAVAILABLE';
}

function resolverFailureStatus(freshness) {
  return freshness === 'STALE' ? 'STALE' : 'UNAVAILABLE';
}
