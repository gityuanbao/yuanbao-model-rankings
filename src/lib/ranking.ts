import type { Catalog, Model, Rate } from './schema';
import { modelSearch } from './search';

export type Metric = 'input' | 'output' | 'task';
export type SortOrder = 'asc' | 'desc';
export type Billing = 'standard' | 'cache' | 'batch' | 'offpeak' | 'promotion';
export type Scenario = 'chat' | 'long' | 'code' | 'custom';
export interface Filters {
  metric: Metric; order: SortOrder; providers: string[]; maxPrice: number | null; minContext: number;
  status: 'available' | 'all' | Model['status']; region: 'all' | Model['region'];
  useCase: 'all' | 'chat' | 'long' | 'code'; scenario: Scenario;
  inputTokens: number; outputTokens: number; billing: Billing; cachePercent: number; query: string;
}
export const scenarios = {
  chat: { name: '日常聊天', input: 1000, output: 1000 },
  long: { name: '长文本', input: 32000, output: 2000 },
  code: { name: 'AI 编程', input: 8000, output: 2000 },
} as const;
export const defaultFilters: Filters = { metric: 'input', order: 'asc', providers: [], maxPrice: null, minContext: 0, status: 'available', region: 'all', useCase: 'all', scenario: 'chat', inputTokens: 1000, outputTokens: 1000, billing: 'standard', cachePercent: 50, query: '' };
export const metricLabels: Record<Metric, string> = { input: '输入价格', output: '输出价格', task: '任务成本' };
export const statusLabels = { active: '正式可用', preview: '预览版', deprecated: '仅存量 / 即将下架', retired: '已下架' };
export const billingLabels: Record<Billing, string> = { standard: '标准费率', cache: '缓存输入', batch: '批量处理', offpeak: '低峰费率', promotion: '限时优惠' };
export function getRate(model: Model, inputTokens: number): Rate | undefined {
  return model.rates.find(rate => inputTokens <= rate.upToInputTokens);
}
export interface Quote { input: number; output: number; cache: number | null; task: number; rate: Rate; applied: Billing }
export function quote(model: Model, filters: Filters, usdToCny: number, today = new Date().toISOString().slice(0, 10)): Quote | null {
  if (!Number.isSafeInteger(filters.inputTokens) || !Number.isSafeInteger(filters.outputTokens) || filters.inputTokens < 0 || filters.outputTokens < 0) return null;
  const usedContext = model.contextScope === 'combined' ? filters.inputTokens + filters.outputTokens : filters.inputTokens;
  if (model.contextTokens !== null && usedContext > model.contextTokens) return null;
  if (model.maxInputTokens != null && filters.inputTokens > model.maxInputTokens) return null;
  if (model.maxOutputTokens !== null && filters.outputTokens > model.maxOutputTokens) return null;
  const rate = getRate(model, filters.inputTokens);
  if (!rate) return null;
  const fx = model.currency === 'USD' ? usdToCny : 1;
  let input = rate.input, output = rate.output, applied: Billing = 'standard';
  if (filters.billing === 'cache' && rate.cacheRead !== null) {
    const hit = Math.min(100, Math.max(0, filters.cachePercent)) / 100;
    input = rate.input * (1 - hit) + rate.cacheRead * hit;
    applied = 'cache';
  } else {
    const factor = filters.billing === 'batch' ? rate.batchFactor : filters.billing === 'offpeak' ? rate.offPeakFactor : filters.billing === 'promotion' && rate.promotion && today >= rate.promotion.startsAt && today <= rate.promotion.endsAt ? rate.promotion.factor : null;
    if (factor !== null) { input *= factor; output *= factor; applied = filters.billing; }
  }
  input *= fx; output *= fx;
  return { input, output, cache: rate.cacheRead === null ? null : rate.cacheRead * fx, task: (filters.inputTokens * input + filters.outputTokens * output) / 1_000_000, rate, applied };
}
export interface Row extends Quote { model: Model; rank: number; tied: boolean; ratio: number | null }
const compareValue = (a: number, b: number) => Math.abs(a - b) <= 1e-12 * Math.max(1, Math.abs(a), Math.abs(b));
export function rankRows(rows: Row[], metric: Metric): Row[] {
  const sorted = [...rows].sort((a, b) => a[metric] - b[metric] || a.model.id.localeCompare(b.model.id));
  let rank = 1;
  return sorted.map((row, index) => {
    if (index > 0 && !compareValue(row[metric], sorted[index - 1][metric])) rank = index + 1;
    const minimum = sorted[0][metric];
    return { ...row, rank, tied: (index > 0 && compareValue(row[metric], sorted[index - 1][metric])) || (index < sorted.length - 1 && compareValue(row[metric], sorted[index + 1][metric])), ratio: minimum === 0 ? (row[metric] === 0 ? 1 : null) : compareValue(row[metric], minimum) ? 1 : row[metric] / minimum };
  });
}
export function getRows(catalog: Catalog, filters: Filters, today?: string): { rows: Row[]; unavailable: number } {
  let unavailable = 0;
  const rows: Row[] = [];
  const matches = modelSearch(filters.query);
  for (const model of catalog.models) {
    if (filters.status === 'available' && model.verification?.status === 'unknown') continue;
    if (filters.providers.length && !filters.providers.includes(model.providerId)) continue;
    if (filters.status === 'available' ? model.status === 'retired' : filters.status !== 'all' && model.status !== filters.status) continue;
    if (filters.region !== 'all' && model.region !== filters.region) continue;
    if (filters.useCase !== 'all' && !model.useCases.includes(filters.useCase)) continue;
    if (filters.minContext && (model.contextTokens ?? 0) < filters.minContext) continue;
    const provider = catalog.providers.find(p => p.id === model.providerId)!;
    if (!matches(model.name, model.apiId, provider.name, provider.shortName, provider.id)) continue;
    const prices = quote(model, filters, catalog.meta.usdToCny, today);
    if (!prices) { unavailable++; continue; }
    // Zero rates remain in the catalog/history, but don't participate in paid-price rankings.
    // Check both the standard tier and the selected billing mode before any ranking or champions.
    if (prices.rate.input <= 0 || prices.rate.output <= 0 || prices.input <= 0 || prices.output <= 0) continue;
    if (filters.maxPrice !== null && prices[filters.metric] > filters.maxPrice) continue;
    rows.push({ model, ...prices, rank: 0, tied: false, ratio: null });
  }
  // Price rank and the minimum-price baseline remain canonical in either display order.
  const ranked = rankRows(rows, filters.metric);
  if (filters.order === 'desc') ranked.sort((a, b) => b.rank - a.rank);
  return { rows: ranked, unavailable };
}
export const money = (value: number, task = false) => {
  if (value > 0 && value < 1e-10) return value.toExponential(2);
  const tiny = value > 0 && value < (task ? 1e-6 : 1e-5);
  return new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: tiny ? 10 : task ? 6 : 5 }).format(value);
};
export const tokens = (value: number | null) => value === null ? '未核验' : value >= 1_000_000 ? `${+(value / 1_000_000).toFixed(3)}M` : `${+(value / 1000).toFixed(3)}K`;
