import { defaultFilters, scenarios, type Filters } from './ranking';
import { providerIds } from './schema';

function choice<T extends string>(value: string | null, values: readonly T[], fallback: T): T {
  return values.includes(value as T) ? value as T : fallback;
}
function numeric(value: string | null, fallback: number, max: number, integer = true) {
  if (value === null || value.trim() === '') return fallback;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= max && (!integer || Number.isSafeInteger(number)) ? number : fallback;
}
export function parseFilters(search: string): Filters {
  const p = new URLSearchParams(search);
  const scenario = choice(p.get('scenario'), ['chat', 'long', 'code', 'custom'], 'chat');
  const preset = scenarios[scenario === 'custom' ? 'chat' : scenario];
  const maxPrice = p.has('max') && p.get('max')?.trim() ? numeric(p.get('max'), -1, 1e9, false) : -1;
  return {
    metric: choice(p.get('rank'), ['input', 'output', 'task'], 'input'),
    order: choice(p.get('order'), ['asc', 'desc'], 'asc'),
    providers: [...new Set((p.get('providers') ?? '').split(',').filter(id => providerIds.includes(id as typeof providerIds[number])))].sort(),
    maxPrice: maxPrice < 0 ? null : maxPrice, minContext: numeric(p.get('context'), 0, 10_000_000),
    status: choice(p.get('status'), ['available', 'all', 'active', 'preview', 'deprecated', 'retired'], 'available'),
    region: choice(p.get('region'), ['all', 'mainland', 'global', 'us', 'singapore'], 'all'),
    useCase: choice(p.get('use'), ['all', 'chat', 'long', 'code'], 'all'), scenario,
    inputTokens: scenario === 'custom' ? numeric(p.get('in'), 1000, 10_000_000) : preset.input,
    outputTokens: scenario === 'custom' ? numeric(p.get('out'), 1000, 10_000_000) : preset.output,
    billing: choice(p.get('billing'), ['standard', 'cache', 'batch', 'offpeak', 'promotion'], 'standard'),
    cachePercent: numeric(p.get('hit'), 50, 100), query: (p.get('q') ?? '').trim().slice(0, 100),
  };
}
export function serializeFilters(filters: Filters): string {
  const p = new URLSearchParams();
  if (filters.metric !== defaultFilters.metric) p.set('rank', filters.metric);
  if (filters.order === 'desc') p.set('order', 'desc');
  if (filters.providers.length) p.set('providers', [...filters.providers].sort().join(','));
  if (filters.maxPrice !== null) p.set('max', String(filters.maxPrice));
  if (filters.minContext) p.set('context', String(filters.minContext));
  if (filters.status !== 'available') p.set('status', filters.status);
  if (filters.region !== 'all') p.set('region', filters.region);
  if (filters.useCase !== 'all') p.set('use', filters.useCase);
  if (filters.scenario !== 'chat') p.set('scenario', filters.scenario);
  if (filters.scenario === 'custom') { p.set('in', String(filters.inputTokens)); p.set('out', String(filters.outputTokens)); }
  if (filters.billing !== 'standard') p.set('billing', filters.billing);
  if (filters.cachePercent !== 50) p.set('hit', String(filters.cachePercent));
  if (filters.query) p.set('q', filters.query);
  const query = p.toString();
  return query ? `?${query}` : '';
}
