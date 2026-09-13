import { z } from 'zod';
import policy from '../../scripts/pricing/policy.json';
import { rateSchema, providerIds, isOfficialUrl } from './schema';
export const timestamp = z.string().datetime();
export const verificationSchema = z.object({
  status: z.enum(['fresh', 'stale', 'manual_review', 'deprecated', 'unknown']),
  lastCheckedAt: timestamp.nullable(), lastSuccessAt: timestamp.nullable(),
  verification: z.enum(['auto_verified', 'manual_verified', 'unverified']), reason: z.string(),
});
export type Verification = z.infer<typeof verificationSchema>;
export const verificationFileSchema = z.object({
  schemaVersion: z.literal(1), checkedAt: timestamp.nullable(), catalogHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  providers: z.record(z.enum(providerIds), verificationSchema), models: z.record(verificationSchema),
});
export type VerificationFile = z.infer<typeof verificationFileSchema>;
export const exchangeRateSchema = z.object({
  schemaVersion: z.literal(1), base: z.literal('USD'), quote: z.literal('CNY'), rate: z.number().positive().finite(),
  updatedAt: timestamp, source: z.object({ type: z.enum(['manual_reference', 'official']), label: z.string().min(1), url: z.string().url().nullable() }), note: z.string().min(1),
});
export const historyEventSchema = z.object({
  id: z.string().min(1), detectedAt: timestamp, effectiveAt: timestamp.nullable(),
  currency: z.enum(['USD','CNY']), rates: z.array(rateSchema).min(1), sourceUrl: z.string().url(),
  reason: z.enum(['initial_snapshot', 'price_change']), verification: z.enum(['auto_verified','manual_verified','unverified']),
  changeTypes: z.array(z.string()),
});
export const historySchema = z.object({ schemaVersion: z.literal(1), models: z.array(z.object({ modelId: z.string(), providerId: z.enum(providerIds), events: z.array(historyEventSchema).min(1) })) }).superRefine((file, ctx) => {
  if (new Set(file.models.map(m => m.modelId)).size !== file.models.length) ctx.addIssue({code:'custom',message:'历史模型重复'});
  for (const model of file.models) {
    if (new Set(model.events.map(e => e.id)).size !== model.events.length) ctx.addIssue({code:'custom',message:'历史事件重复'});
    for (let i = 0; i < model.events.length; i++) {
      const event = model.events[i];
      if (!isOfficialUrl(event.sourceUrl, model.providerId)) ctx.addIssue({code:'custom',message:'历史来源非官方'});
      if (i && Date.parse(event.detectedAt) < Date.parse(model.events[i - 1].detectedAt)) ctx.addIssue({code:'custom',message:'历史事件时间倒序'});
    }
  }
});
export type PriceHistory = z.infer<typeof historySchema>;
export const freshnessLabels: Record<Verification['status'], string> = { fresh: '核验成功', stale: '保留上次有效价', manual_review: '变化待审核 · 沿用旧价', deprecated: '官方停止提供', unknown: '未确认 · 不参与默认榜' };
export function verificationText(value: Verification | undefined, fallbackDate: string, now = Date.now()) {
  if (!value) return `数据核验：${fallbackDate}`;
  const time = value.lastSuccessAt ? new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false }).format(new Date(value.lastSuccessAt)) : fallbackDate;
  const overdue = now - new Date(value.lastSuccessAt ?? `${fallbackDate}T00:00:00Z`).getTime() > policy.staleAfterDays * 86400_000;
  return `数据核验：${time} · ${freshnessLabels[value.status]}${overdue ? ` · ⚠ 超过 ${policy.staleAfterDays} 天未成功核验` : ''}`;
}
