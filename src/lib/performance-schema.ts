import { z } from 'zod';
import { providerIds } from './schema';

export const arenaSource = {
  id: 'arena-text-style-control',
  name: 'Arena',
  dataset: 'lmarena-ai/leaderboard-dataset',
  config: 'text_style_control',
  category: 'overall',
  url: 'https://huggingface.co/datasets/lmarena-ai/leaderboard-dataset/viewer/text_style_control/latest',
  leaderboardUrl: 'https://arena.ai/leaderboard/text',
  license: 'CC-BY-4.0',
  licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
  method: 'Bradley–Terry · 风格控制 · overall',
} as const;
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v);
const id = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
export const selectionModelSchema = z.object({ id, providerId: z.enum(providerIds), name: z.string().min(1), mode: z.string().min(1).optional(), sourceModel: z.string().min(1) });
export const selectionSchema = z.object({
  version: z.literal(1),
  includeProviderFamilies: z.boolean().optional(),
  models: z.array(selectionModelSchema).min(1),
}).superRefine((data, ctx) => {
  for (const key of ['id', 'sourceModel'] as const) if (new Set(data.models.map(m => m[key])).size !== data.models.length) ctx.addIssue({code:'custom', message:`收录清单 ${key} 重复`});
});
export type PerformanceSelection = z.infer<typeof selectionSchema>;
const score = z.number().finite().positive().max(5000);
export const performanceModelSchema = selectionModelSchema.extend({
  score, lower: score.nullable(), upper: score.nullable(),
  scorePrecision: z.literal('rounded').optional(),
  uncertainty: z.number().finite().nonnegative().optional(),
  preliminary: z.boolean().optional(),
  votes: z.number().int().positive(), sourceRank: z.number().int().positive(),
}).superRefine((m, ctx) => {
  if (m.scorePrecision === 'rounded') {
    if (!Number.isInteger(m.score) || m.uncertainty === undefined || m.lower !== null || m.upper !== null) ctx.addIssue({code:'custom',message:'官网整数分必须保留原始 ± 值，不能推测精确区间'});
  } else if (m.lower === null || m.upper === null || m.lower > m.score || m.upper < m.score) ctx.addIssue({code:'custom', message:'得分不在置信区间内'});
});
export const performanceSnapshotSchema = z.object({
  schemaVersion: z.literal(1), sourceId: z.literal(arenaSource.id),
  publishedAt: date, retrievedAt: z.string().datetime(),
  retrieval: z.enum(['official-api', 'official-page', 'reviewed-official-view', 'reviewed-official-page']),
  sourceUrl: z.enum([arenaSource.url, arenaSource.leaderboardUrl]).optional(),
  sourceRowCount: z.number().int().positive(),
  models: z.array(performanceModelSchema).min(1),
}).superRefine((data, ctx) => {
  if (data.models.length > data.sourceRowCount) ctx.addIssue({code:'custom',message:'收录数量大于来源数量'});
  if (data.publishedAt > data.retrievedAt.slice(0, 10)) ctx.addIssue({code:'custom',message:'榜单日期不能晚于抓取日期'});
  if (new Set(data.models.map(m => m.id)).size !== data.models.length || new Set(data.models.map(m => m.sourceModel)).size !== data.models.length) ctx.addIssue({code:'custom',message:'重复模型'});
  if (new Set(data.models.map(m=>m.scorePrecision ?? 'exact')).size !== 1) ctx.addIssue({code:'custom',message:'同一榜单不可混用官网整数分和数据集精确分'});
  if (data.models.some(m=>m.scorePrecision==='rounded') && data.sourceUrl!==arenaSource.leaderboardUrl) ctx.addIssue({code:'custom',message:'整数分必须注明官网榜单来源'});
});
export type PerformanceSnapshot = z.infer<typeof performanceSnapshotSchema>;
export type PerformanceModel = z.infer<typeof performanceModelSchema>;
export const performanceHistorySchema = z.object({schemaVersion:z.literal(1), snapshots:z.array(performanceSnapshotSchema).min(1)});
