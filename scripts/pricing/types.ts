import { z } from 'zod';
import { providerIds, rateSchema, isOfficialUrl, type Model } from '../../src/lib/schema';
export type ProviderId = typeof providerIds[number];
export interface RawPricingSnapshot { providerId: ProviderId; url: string; fetchedAt: string; body: string; sha256: string }
export const normalizedPriceSchema = z.object({
  modelId: z.string().min(1), providerId: z.enum(providerIds), apiId: z.string().min(1),
  currency: z.enum(['USD', 'CNY']), unit: z.literal('per_1m_tokens'), sourceUrl: z.string().url(),
  name: z.string().optional(), status: z.enum(['active', 'preview', 'deprecated', 'retired']).optional(),
  rates: z.array(rateSchema).min(1), effectiveAt: z.string().datetime().nullable().default(null),
  evidence: z.object({
    modelLabel: z.string().min(1), unitLabel: z.string().min(1), inputLabel: z.string().min(1), outputLabel: z.string().min(1),
    standardLabel: z.string().min(1), structure: z.string().min(1), pageSha256: z.string().regex(/^[a-f0-9]{64}$/),
    excerpt: z.string().min(1).max(2000),
  }),
}).superRefine((item, ctx) => {
  const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
  if (!isOfficialUrl(item.sourceUrl, item.providerId)) fail('非官方来源');
  if (!/百万|1M|million|MTok/i.test(item.evidence.unitLabel)) fail('缺少明确的百万 Token 单位');
  const inputLabel = item.evidence.inputLabel.replace(/缓存未命中|未命中缓存|cache miss|uncached/gi, '');
  if (!/input|输入/i.test(inputLabel) || /cache hit|cached|缓存|batch|批量/i.test(inputLabel)) fail('缓存或 Batch 不能充当标准输入价');
  if (!/output|输出/i.test(item.evidence.outputLabel) || /batch|批量/i.test(item.evidence.outputLabel)) fail('缺少标准输出列');
  if (!/standard|base|peak|原价|标准|在线推理|刊例价|按量/i.test(item.evidence.standardLabel)) fail('标准计费模式不明确');
  const compact = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!compact(item.evidence.modelLabel).includes(compact(item.apiId))) fail('正文模型标识不匹配');
  item.rates.forEach((rate, i) => { if (i && rate.upToInputTokens <= item.rates[i - 1].upToInputTokens) fail('输入阶梯重复或倒序'); });
});
export type NormalizedPrice = z.infer<typeof normalizedPriceSchema>;
export interface ParseIssue { modelId: string; reason: string }
export interface Discovery { apiId: string; sourceUrl: string; label: string }
export interface ParsedPricing { items: NormalizedPrice[]; issues: ParseIssue[]; discoveries: Discovery[] }
export interface ValidationResult { valid: boolean; errors: string[] }
export interface ProviderAdapter {
  providerId: ProviderId; mode: 'automatic' | 'manual'; reason?: string; sourceUrl: string;
  fetch(fetcher?: typeof fetch): Promise<RawPricingSnapshot>;
  parse(raw: RawPricingSnapshot, models: Model[]): ParsedPricing;
  validate(items: NormalizedPrice[]): ValidationResult;
}
export interface ProviderRun { providerId: ProviderId; mode: ProviderAdapter['mode']; checkedAt: string; parsed?: ParsedPricing; error?: string; manualReason?: string }
