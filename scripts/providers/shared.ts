import { createHash } from 'node:crypto';
import { parse, type DefaultTreeAdapterMap } from 'parse5';
import { isOfficialUrl, type Model, type Rate } from '../../src/lib/schema';
import { normalizedPriceSchema, type ProviderAdapter, type ProviderId, type RawPricingSnapshot, type ParsedPricing, type NormalizedPrice } from '../pricing/types';

type Node = DefaultTreeAdapterMap['node'];
export type Element = DefaultTreeAdapterMap['element'];
export const children = (node: Node): Node[] => 'childNodes' in node ? node.childNodes : [];
export const attr = (node: Element, name: string) => node.attrs.find(a => a.name === name)?.value;
export const text = (node: Node): string => node.nodeName === '#text' ? (node as DefaultTreeAdapterMap['textNode']).value : ['script', 'style', 'sup', 'noscript'].includes(node.nodeName) ? '' : children(node).map(text).join(' ').replace(/\s+/g, ' ').trim();
export function elements(node: Node, tag: string): Element[] { return [...(node.nodeName === tag ? [node as Element] : []), ...children(node).flatMap(n => elements(n, tag))]; }
export const document = (raw: RawPricingSnapshot) => parse(raw.body);
export const tables = (raw: RawPricingSnapshot) => elements(document(raw), 'table');
export function grid(table: Element): string[][] {
  const matrix: string[][] = [];
  elements(table, 'tr').forEach((row, ri) => {
    matrix[ri] ??= [];
    let ci = 0;
    for (const cell of children(row).filter(n => ['th', 'td'].includes(n.nodeName)) as Element[]) {
      if (attr(cell, 'rowspan') === '0' || attr(cell, 'colspan') === '0') continue;
      while (matrix[ri][ci] !== undefined) ci++;
      const rs = Math.max(1, parseInt(attr(cell, 'rowspan') ?? '1', 10));
      const cs = Math.max(1, parseInt(attr(cell, 'colspan') ?? '1', 10));
      if (rs > 200 || cs > 50 || !Number.isFinite(rs) || !Number.isFinite(cs)) throw new Error('不支持的表格跨度');
      for (let r = ri; r < ri + rs; r++) { matrix[r] ??= []; for (let c = ci; c < ci + cs; c++) { if (matrix[r][c] !== undefined) throw new Error('表格单元格重叠'); matrix[r][c] = text(cell); } }
      ci += cs;
    }
  });
  return matrix;
}
export function one<T>(values: T[], label: string): T { if (values.length !== 1) throw new Error(`${label} 应唯一，实际 ${values.length} 项；页面结构或计费条件变化`); return values[0]; }
export function amount(value: string, currency: 'CNY' | 'USD', scale = 1): number {
  const cleaned = value.trim().replace(currency === 'CNY' ? /^(?:¥|￥)\s*|\s*元$/g : /^\$\s*/g, '').trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(cleaned)) throw new Error(`价格不是唯一明确数值：${value.slice(0,80)}`);
  return Number((Number(cleaned) * scale).toPrecision(12));
}
export function equalFactor(input: number, output: number, batchInput: number, batchOutput: number): number {
  if (input <= 0 || output <= 0) return 1; // The safety gate will reject zero standard rates.
  const a = batchInput / input, b = batchOutput / output;
  if (a <= 0 || a > 1 || Math.abs(a - b) > 1e-9) throw new Error('输入和输出优惠比例不一致，需人工适配');
  return Number(a.toPrecision(12));
}
export function candidate(raw: RawPricingSnapshot, model: Model, rates: Rate[], labels: Omit<NormalizedPrice['evidence'], 'pageSha256' | 'modelLabel'> & { modelLabel?: string; currency: 'USD' | 'CNY' }): NormalizedPrice {
  const { currency, ...evidence } = labels;
  return { modelId: model.id, providerId: model.providerId, apiId: model.apiId, currency, unit: 'per_1m_tokens', sourceUrl: raw.url, rates, effectiveAt: null,
    evidence: { ...evidence, modelLabel: labels.modelLabel ?? model.apiId, pageSha256: raw.sha256 } };
}
export async function fetchOfficial(providerId: ProviderId, initialUrl: string, fetcher: typeof fetch = fetch): Promise<RawPricingSnapshot> {
  const signal = AbortSignal.timeout(30_000);
  let url = initialUrl;
  for (let i = 0; i < 5; i++) {
    if (!isOfficialUrl(url, providerId)) throw new Error('拒绝非官方 URL 或跨厂商重定向');
    const response = await fetcher(url, { signal, redirect: 'manual', headers: { Accept: 'text/html,application/json,text/plain', 'User-Agent': 'Yuanbao-Pricing/2.1 (public official pricing; 6-hour checks)' } });
    if (response.status >= 300 && response.status < 400) { const location = response.headers.get('location'); if (!location) throw new Error('缺少重定向目标'); url = new URL(location, url).href; continue; }
    if (!response.ok) throw new Error(`HTTP ${response.status}，保留上次有效价格`);
    if (Number(response.headers.get('content-length')) > 5_000_000) throw new Error('来源内容过大');
    const reader = response.body?.getReader(); if (!reader) throw new Error('空响应');
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 5_000_000) { await reader.cancel(); throw new Error('来源内容过大'); } chunks.push(value); }
    const body = Buffer.concat(chunks).toString('utf8');
    if (!body.trim()) throw new Error('空定价页面');
    return { providerId, url, body, fetchedAt: new Date().toISOString(), sha256: createHash('sha256').update(body).digest('hex') };
  }
  throw new Error('重定向次数超限');
}
export function adapter(providerId: ProviderId, sourceUrl: string, parser: ProviderAdapter['parse']): ProviderAdapter {
  return { providerId, sourceUrl, mode: 'automatic', fetch: fetcher => fetchOfficial(providerId, sourceUrl, fetcher), parse: parser,
    validate: items => { const errors = items.flatMap(item => { const r = normalizedPriceSchema.safeParse(item); return r.success ? [] : r.error.issues.map(i => `${item.modelId}: ${i.message}`); }); return { valid: errors.length === 0, errors }; } };
}
export function manual(providerId: ProviderId, sourceUrl: string, reason: string): ProviderAdapter {
  return { ...adapter(providerId, sourceUrl, () => { throw new Error(reason); }), mode: 'manual', reason };
}
// Only explicitly unsupported, known pricing cases may use this marker.
export class ManualPricingRequiredError extends Error {}
export function perModel(models: Model[], parseModel: (model: Model) => NormalizedPrice, discoveries: ParsedPricing['discoveries'] = []): ParsedPricing {
  const result: ParsedPricing = { items: [], issues: [], discoveries };
  for (const model of models.filter(m => m.status !== 'retired')) { try { result.items.push(parseModel(model)); } catch (error) { result.issues.push({ modelId: model.id, reason: error instanceof Error ? error.message : String(error), kind: error instanceof ManualPricingRequiredError ? 'manual_required' : 'parse_error' }); } }
  return result;
}
