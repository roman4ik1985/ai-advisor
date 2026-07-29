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

export async function resolveLiveEvidence({ route, queryCatalog, now = () => new Date() }) {
  const requiredResolvers = new Set(route?.requiredResolvers || []);
  let catalog = [];
  let catalogDiagnostics = {
    code: 'SKIPPED_BY_ROUTE',
    message: 'Catalog lookup skipped because this route does not require it.',
  };
  let catalogResolver = notRequiredResolver();
  let priceResolver = notRequiredResolver();

  if (requiredResolvers.has('catalog') || requiredResolvers.has('price')) {
    const result = await queryCatalog();
    catalog = Array.isArray(result?.products) ? result.products : [];
    catalogDiagnostics = result?.diagnostics || { code: 'UNKNOWN' };
    const checkedAt = now().toISOString();
    const hasProducts = catalog.length > 0 && catalogDiagnostics.code === 'OK';
    catalogResolver = {
      status: hasProducts ? 'AVAILABLE' : 'UNAVAILABLE',
      source: hasProducts ? 'public_catalog_search' : null,
      checkedAt,
      reason: hasProducts ? null : catalogDiagnostics.code,
    };
    if (requiredResolvers.has('price')) {
      const hasPrice = catalog.some((product) => Array.isArray(product?.prices) && product.prices.length > 0);
      priceResolver = {
        status: hasPrice ? 'AVAILABLE' : 'UNAVAILABLE',
        source: hasPrice ? 'public_catalog_search' : null,
        checkedAt,
        reason: hasPrice ? null : catalogDiagnostics.code,
      };
    }
  }

  return {
    catalog,
    catalogDiagnostics,
    evidence: {
      catalog: catalogResolver,
      price: priceResolver,
      inventory: requiredResolvers.has('inventory')
        ? unavailableResolver('NO_AUTHORIZED_READ_ONLY_SOURCE')
        : notRequiredResolver(),
      delivery: requiredResolvers.has('delivery')
        ? unavailableResolver('NO_AUTHORIZED_READ_ONLY_SOURCE')
        : notRequiredResolver(),
    },
  };
}
