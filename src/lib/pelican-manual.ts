import { z } from 'zod';
import data from '../../data/pelican/manual-scores-2026-09-15.json';
import additionalData from '../../data/pelican/manual-scores-2026-09-23.json';

export const pelicanManualCriteria = [
  { id: 'cat', label: '猫是否合理', maximum: 2, description: '能认出是白猫，身体与四肢连接自然，坐在车上、前爪扶把，骑姿合理。' },
  { id: 'bicycle', label: '自行车是否合理', maximum: 2, description: '车轮、车架、车把、车座和脚踏清楚，连接正确，没有明显悬空、错位或穿插。' },
  { id: 'scenery', label: '景色是否合理', maximum: 2, description: '背景、地面与主体协调，空间关系自然。简洁背景也可满分，不按景物数量评分。' },
  { id: 'motion', label: '运动逻辑是否合理', maximum: 2, description: '后腿与脚踏配合自然；有动画时，蹬踏、车轮与场景运动协调，不能只是轮子转、脚乱晃。' },
  { id: 'design', label: '整体设计美观是否合理', maximum: 2, description: '构图舒服、主体突出，配色与线条协调，风格统一，细节完整。' },
] as const;

const score = z.number().finite().min(0).max(2).multipleOf(0.5);
const manualScoresSchema = z.object({ cat: score, bicycle: score, scenery: score, motion: score, design: score }).strict();
export type PelicanManualScores = z.infer<typeof manualScoresSchema>;
export const pelicanManualEntrySchema = z.object({
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  name: z.string().trim().min(1),
  sourceRow: z.number().int().positive(),
  scores: manualScoresSchema,
  submittedTotal: z.number().finite().min(0).max(10),
}).strict().superRefine((entry, ctx) => {
  if (getManualTotal(entry.scores) !== entry.submittedTotal) {
    ctx.addIssue({ code: 'custom', path: ['submittedTotal'], message: '人工总分必须等于五项得分之和' });
  }
});

export const pelicanManualSchema = z.object({
  schemaVersion: z.literal(1),
  rubricVersion: z.literal('manual-10-v1'),
  receivedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reviewer: z.literal('源宝'),
  source: z.union([
    z.object({ file: z.string().min(1), sheet: z.string().min(1), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
    z.object({ kind: z.literal('chat-table'), file: z.string().min(1), sha256: z.string().regex(/^[a-f0-9]{64}$/), totals: z.literal('sum-of-five-scores') }).strict(),
  ]),
  entries: z.array(pelicanManualEntrySchema),
}).strict().superRefine((board, ctx) => {
  const ids = new Set<string>();
  const sourceRows = new Set<number>();
  board.entries.forEach((entry, index) => {
    if (ids.has(entry.id) || sourceRows.has(entry.sourceRow)) {
      ctx.addIssue({ code: 'custom', path: ['entries', index], message: '人工评分的模型与源表行不能重复' });
    }
    ids.add(entry.id);
    sourceRows.add(entry.sourceRow);
  });
});

export function getManualTotal(scores: PelicanManualScores) {
  return pelicanManualCriteria.reduce((sum, item) => sum + scores[item.id], 0);
}

// New manual marks are separate from the archived 100-point AI assessments.
export const pelicanManualBatches = [data, additionalData].map(batch => pelicanManualSchema.parse(batch));
export function combinePelicanManualBatches(batches: Array<z.infer<typeof pelicanManualSchema>>) {
  const entries = batches.flatMap(batch => batch.entries);
  if (new Set(entries.map(entry => entry.id)).size !== entries.length) throw new Error('人工评分批次不能重复收录同一模型');
  return { entries };
}
export const pelicanManualBoard = combinePelicanManualBatches(pelicanManualBatches);
