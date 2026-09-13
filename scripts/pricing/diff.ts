import { createHash } from 'node:crypto';
import type { Catalog, Model, Rate } from '../../src/lib/schema';
import type { NormalizedPrice } from './types';
export function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${JSON.stringify(k)}:${stable(v)}`).join(',')}}`;
  return JSON.stringify(value);
}
export const hash = (value: unknown) => createHash('sha256').update(stable(value)).digest('hex');
export const semanticRates = (rates: Rate[]) => rates.map(({ label: _label, ...rest }) => rest);
export const officialPrice = (model: Pick<Model,'currency'|'rates'>) => ({ currency: model.currency, rates: semanticRates(model.rates) });
export interface Change { type: string; field: string; before: unknown; after: unknown; relativeChange: number | null }
export function diffPrice(old: Model | undefined, next: NormalizedPrice, oldSourceUrl?: string): Change[] {
  const changes: Change[] = [];
  const add = (type: string, field: string, before: unknown, after: unknown) => { if (stable(before) !== stable(after)) changes.push({ type, field, before: before ?? null, after: after ?? null, relativeChange: typeof before === 'number' && before > 0 && typeof after === 'number' ? (after - before) / before : null }); };
  if (!old) { add('new_model','model',null,next); return changes; }
  add('currency_change','currency',old.currency,next.currency);
  add('model_name_change','name',old.name,next.name ?? old.name);
  add('model_version_change','apiId',old.apiId,next.apiId);
  add(next.status === 'retired' ? 'model_retired' : 'model_status_change','status',old.status,next.status ?? old.status);
  add('source_url_change','sourceUrl',oldSourceUrl,next.sourceUrl);
  add('context_tiers_change','tiers',old.rates.map(r=>r.upToInputTokens),next.rates.map(r=>r.upToInputTokens));
  next.rates.forEach((rate, i) => {
    const previous = old.rates.find(r => r.upToInputTokens === rate.upToInputTokens);
    for (const field of ['input','output','cacheRead','batchFactor','offPeakFactor','promotion'] as const) {
      const before = previous?.[field], after = rate[field];
      const type = field === 'input' || field === 'output' ? `${field}_${typeof before === 'number' && Number(after) < before ? 'down' : 'up'}` : field === 'cacheRead' ? 'cache_price_change' : field === 'batchFactor' ? 'batch_change' : field === 'offPeakFactor' ? 'time_price_change' : before === null ? 'promotion_start' : after === null ? 'promotion_end' : 'promotion_change';
      add(type, `rates.${i}.${field}`, before, after);
    }
  });
  return changes;
}
export function meaningfulCatalog(catalog: Catalog) {
  return { providers: catalog.providers, sources: catalog.sources, models: catalog.models.map(({verifiedAt: _at, verification: _verification, ...model}) => ({ ...model, rates: semanticRates(model.rates) })) };
}
