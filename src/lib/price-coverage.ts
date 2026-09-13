import type { Catalog } from './schema';
import { getRows, type Filters } from './ranking';

export function pendingPriceProviders(catalog: Catalog, filters: Filters) {
  if (filters.status !== 'available') return [];
  const unchecked = getRows(catalog, { ...filters, status: 'all' }).rows
    .filter(row => row.model.status !== 'retired' && row.model.verification?.status === 'unknown');
  return catalog.providers.filter(provider => !filters.providers.length || filters.providers.includes(provider.id)).flatMap(provider => {
    const count = unchecked.filter(row => row.model.providerId === provider.id).length;
    const hasModels = catalog.models.some(model => model.providerId === provider.id);
    if (!count && !(provider.pendingReason && !hasModels)) return [];
    return [{ provider, count, reason: count ? `${count} 个型号尚未完成官方价格核验，确认后再参与排名。` : provider.pendingReason! }];
  });
}
