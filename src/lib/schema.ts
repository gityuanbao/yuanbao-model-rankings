import { z } from 'zod';

export const providerIds = ['openai', 'anthropic', 'google', 'xai', 'deepseek', 'bytedance', 'alibaba', 'moonshot', 'zhipu', 'minimax', 'baidu', 'tencent'] as const;
export const officialDomains: Record<typeof providerIds[number], string[]> = {
  openai: ['openai.com'], anthropic: ['anthropic.com', 'claude.com'], google: ['ai.google.dev'],
  xai: ['x.ai'], deepseek: ['deepseek.com'], bytedance: ['volcengine.com'],
  alibaba: ['aliyun.com'], moonshot: ['moonshot.cn', 'moonshot.ai', 'kimi.com', 'kimi.ai'],
  zhipu: ['bigmodel.cn'], minimax: ['minimaxi.com', 'minimax.cn', 'minimax.io'],
  baidu: ['cloud.baidu.com', 'ai.baidu.com'], tencent: ['cloud.tencent.com', 'cloud.tencent.cn'],
};
export function isOfficialUrl(value: string, providerId: typeof providerIds[number]) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && officialDomains[providerId].some(domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`));
  } catch { return false; }
}
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, '日期无效');
const tokenCount = z.number().int().positive().max(10_000_000);
const price = z.number().finite().nonnegative();
export const rateSchema = z.object({
  label: z.string().min(1), upToInputTokens: tokenCount,
  input: price, output: price, cacheRead: price.nullable(),
  batchFactor: z.number().positive().max(1).nullable(),
  offPeakFactor: z.number().positive().max(1).nullable(),
  promotion: z.object({ factor: z.number().positive().max(1), startsAt: date, endsAt: date, note: z.string().min(1) }).nullable(),
});
export const modelSchema = z.object({
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/), name: z.string().min(1), apiId: z.string().min(1),
  providerId: z.enum(providerIds), status: z.enum(['active', 'preview', 'deprecated', 'retired']),
  region: z.enum(['mainland', 'global', 'us', 'singapore']), regionLabel: z.string().min(1),
  description: z.string().min(1), useCases: z.array(z.enum(['chat', 'long', 'code'])).min(1),
  contextTokens: tokenCount.nullable(), contextScope: z.enum(['combined', 'input']), maxInputTokens: tokenCount.nullable().optional(),
  maxOutputTokens: tokenCount.nullable(), currency: z.enum(['CNY', 'USD']),
  sourceId: z.string().min(1), specSource: z.string().url().nullable(), verifiedAt: date,
  notes: z.array(z.string()), zeroPriceReason: z.string().min(1).nullable(), rates: z.array(rateSchema).min(1),
  verification: z.object({
    status: z.enum(['fresh', 'stale', 'manual_review', 'deprecated', 'unknown']),
    lastCheckedAt: z.string().datetime().nullable(), lastSuccessAt: z.string().datetime().nullable(),
    verification: z.enum(['auto_verified', 'manual_verified', 'unverified']), reason: z.string(),
  }).optional(),
}).superRefine((model, ctx) => {
  model.rates.forEach((rate, i) => {
    if (i > 0 && rate.upToInputTokens <= model.rates[i - 1].upToInputTokens) ctx.addIssue({ code: 'custom', message: '阶梯必须严格递增' });
    if ((rate.input === 0 || rate.output === 0) && !model.zeroPriceReason) ctx.addIssue({ code: 'custom', message: '零价必须有官方免费依据' });
    if (rate.promotion && rate.promotion.startsAt > rate.promotion.endsAt) ctx.addIssue({ code: 'custom', message: '促销日期范围无效' });
  });
  if (model.specSource && !isOfficialUrl(model.specSource, model.providerId)) ctx.addIssue({ code: 'custom', message: '规格来源必须为本厂商官方域名' });
});
export const catalogSchema = z.object({
  meta: z.object({ version: z.literal(1), updatedAt: date, usdToCny: z.number().positive(), exchangeRateNote: z.string().min(1) }),
  providers: z.array(z.object({ id: z.enum(providerIds), name: z.string(), shortName: z.string(), mark: z.string(), color: z.string().regex(/^#[a-fA-F0-9]{6}$/), pendingReason: z.string().nullable() })).length(12),
  sources: z.array(z.object({ id: z.string(), providerId: z.enum(providerIds), title: z.string(), url: z.string().url(), retrieval: z.enum(['page', 'search-index']), notes: z.string() })),
  models: z.array(modelSchema),
}).superRefine((data, ctx) => {
  for (const [label, values] of [['厂商', data.providers], ['来源', data.sources], ['模型', data.models]] as const) {
    if (new Set(values.map(v => v.id)).size !== values.length) ctx.addIssue({ code: 'custom', message: `${label} ID 重复` });
  }
  for (const source of data.sources) {
    if (!isOfficialUrl(source.url, source.providerId)) ctx.addIssue({ code: 'custom', message: `非官方价格源：${source.id}` });
  }
  for (const model of data.models) {
    const source = data.sources.find(s => s.id === model.sourceId);
    if (!source || source.providerId !== model.providerId) ctx.addIssue({ code: 'custom', message: `模型与来源厂商不一致：${model.id}` });
    if (model.verifiedAt > data.meta.updatedAt) ctx.addIssue({ code: 'custom', message: `核验晚于数据快照：${model.id}` });
  }
});
export type Catalog = z.infer<typeof catalogSchema>;
export type Model = z.infer<typeof modelSchema>;
export type Rate = z.infer<typeof rateSchema>;
export type Provider = Catalog['providers'][number];
