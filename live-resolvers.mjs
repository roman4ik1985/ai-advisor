function unavailableResolver(reason) {
  return {
    status: 'UNAVAILABLE',
    source: null,
    checkedAt: null,
    reason,
  };
}

function notRequiredResolver() {
  return {
    status: 'NOT_REQUIRED',
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
  const liveFacts = {};

  if (requiredResolvers.has('catalog') || requiredResolvers.has('price')) {
    const result = querySalesdriveCatalog
      ? await querySalesdriveCatalog(question)
      : await queryCatalog();
    catalog = Array.isArray(result?.products) ? result.products : [];
    catalogDiagnostics = result?.diagnostics || { code: 'UNKNOWN' };
    const checkedAt = now().toISOString();
    const source = result?.source || 'public_catalog_search';
    const fetchedAt = result?.fetchedAt || checkedAt;
    const hasProducts = catalog.length > 0 && catalogDiagnostics.code === 'OK';
    catalogResolver = {
      status: hasProducts ? 'AVAILABLE' : 'UNAVAILABLE',
      source: hasProducts ? source : null,
      checkedAt: fetchedAt,
      reason: hasProducts ? null : catalogDiagnostics.code,
    };
    if (requiredResolvers.has('price')) {
      const hasPrice = catalog.some((product) => Array.isArray(product?.prices) && product.prices.length > 0);
      priceResolver = {
        status: hasPrice ? 'AVAILABLE' : 'UNAVAILABLE',
        source: hasPrice ? source : null,
        checkedAt: fetchedAt,
        reason: hasPrice ? null : catalogDiagnostics.code,
      };
    }
    if (requiredResolvers.has('inventory')) {
      const inventoryProducts = catalog.filter((product) => ['IN_STOCK', 'OUT_OF_STOCK'].includes(product?.availability?.state));
      inventoryResolver = {
        status: inventoryProducts.length > 0 ? 'AVAILABLE' : 'UNAVAILABLE',
        source: inventoryProducts.length > 0 ? source : null,
        checkedAt: inventoryProducts.length > 0 ? fetchedAt : null,
        reason: inventoryProducts.length > 0 ? null : 'SALES_DRIVE_STOCK_NOT_PRESENT',
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
    const hasDeliveryMethods = items.length > 0 && result?.diagnostics?.code === 'OK';
    deliveryResolver = {
      status: hasDeliveryMethods ? 'AVAILABLE' : 'UNAVAILABLE',
      source: hasDeliveryMethods ? (result?.source || 'salesdrive_api') : null,
      checkedAt: hasDeliveryMethods ? (result?.fetchedAt || now().toISOString()) : null,
      reason: hasDeliveryMethods ? null : String(result?.diagnostics?.code || 'SALES_DRIVE_API_UNAVAILABLE'),
      capabilities: hasDeliveryMethods ? ['methods'] : [],
    };
    if (hasDeliveryMethods) liveFacts.deliveryMethods = items;
  }

  return {
    catalog,
    catalogDiagnostics,
    evidence: {
      catalog: catalogResolver,
      price: priceResolver,
      inventory: requiredResolvers.has('inventory') ? inventoryResolver : notRequiredResolver(),
      delivery: requiredResolvers.has('delivery') ? deliveryResolver : notRequiredResolver(),
    },
    liveFacts,
  };
}
