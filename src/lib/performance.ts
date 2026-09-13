import type { PerformanceModel, PerformanceSnapshot } from './performance-schema';
import type { Catalog } from './schema';
import { providerIds } from './schema';
import { arenaSource } from './performance-schema';
import { modelSearch } from './search';
import { categoryForSource, performanceCategories, performanceCategoryIds, type PerformanceCategory, type PerformanceBoardSnapshot, type AgentModel } from './performance-categories';

export interface PerformanceFilters { category: PerformanceCategory; providers: string[]; query: string; order: 'asc' | 'desc' }
export const defaultPerformanceFilters: PerformanceFilters = {category:'text', providers: [], query: '', order: 'desc'};
export function parsePerformanceFilters(search: string): PerformanceFilters {
  const p = new URLSearchParams(search);
  return {category:performanceCategoryIds.includes(p.get('category') as PerformanceCategory) ? p.get('category') as PerformanceCategory : 'text', order:p.get('order') === 'asc' ? 'asc' : 'desc', query:(p.get('q') ?? '').trim().slice(0,100),
    providers:[...new Set((p.get('providers') ?? '').split(',').filter(v => providerIds.includes(v as typeof providerIds[number])))].sort()};
}
export function serializePerformanceFilters(filters: PerformanceFilters) {
  const p = new URLSearchParams();
  if (filters.category !== 'text') p.set('category',filters.category);
  if (filters.order === 'asc') p.set('order','asc');
  if (filters.providers.length) p.set('providers',[...filters.providers].sort().join(','));
  if (filters.query) p.set('q', filters.query);
  return p.size ? `?${p}` : '';
}
export type PerformanceRow = (PerformanceModel | AgentModel) & { rank: number; tied: boolean; sourceUrl:string; category:PerformanceCategory };
export function getPerformanceRows(snapshot: PerformanceSnapshot, catalog: Catalog, filters: PerformanceFilters): (PerformanceModel & {rank:number; tied:boolean; sourceUrl:string; category:PerformanceCategory})[];
export function getPerformanceRows(snapshot: PerformanceBoardSnapshot, catalog: Catalog, filters: PerformanceFilters): PerformanceRow[];
export function getPerformanceRows(snapshot: PerformanceBoardSnapshot, catalog: Catalog, filters: PerformanceFilters): PerformanceRow[] {
  const category=categoryForSource(snapshot.sourceId);
  const first=snapshot.models[0];
  const rounded=category==='agent' || ('scorePrecision' in first && first.scorePrecision==='rounded');
  const score=(model:PerformanceModel|AgentModel)=>'score' in model?model.score:0;
  const ordered = [...snapshot.models].sort((a,b) => (rounded?a.sourceRank-b.sourceRank:score(b)-score(a)) || a.sourceRank-b.sourceRank || a.id.localeCompare(b.id));
  let rank = 0;
  // Ranks belong to the curated leaderboard; filtering and sort direction don't rewrite them.
  const ranked = ordered.map((model, i) => {
    if (!i || (rounded?model.sourceRank!==ordered[i-1].sourceRank:score(model) !== score(ordered[i-1]))) rank = i+1;
    return {...model, rank, category, sourceUrl:snapshot.sourceUrl ?? (category==='text'?arenaSource.url:performanceCategories[category].url), tied:ordered.some(other => other.id !== model.id && (rounded?other.sourceRank===model.sourceRank:score(other) === score(model)))};
  });
  const matches = modelSearch(filters.query);
  const selected = ranked.filter(model => {
    const provider = catalog.providers.find(p => p.id === model.providerId)!;
    return (!filters.providers.length || filters.providers.includes(model.providerId)) && matches(model.name,model.mode,model.sourceModel,provider.name,provider.shortName,provider.id);
  });
  return filters.order === 'desc' ? selected : selected.sort((a,b) => b.rank-a.rank || a.id.localeCompare(b.id));
}
