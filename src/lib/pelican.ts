import { z } from 'zod';
import { providerIds, type Catalog } from './schema';
import { modelSearch } from './search';

export const pelicanTiers = [
  { id: 'hang', label: '夯', minimum: 90 },
  { id: 'top', label: '顶级', minimum: 75 },
  { id: 'good', label: '人上人', minimum: 60 },
  { id: 'npc', label: 'NPC', minimum: 40 },
  { id: 'la', label: '拉', minimum: 0 },
] as const;

export const pelicanCriteria = [
  { id: 'cat_shape', label: '猫咪是否清楚', category: '白猫形象', maximum: 10, kind: 'visual', description: '不靠标题也能看出是猫，五官、身体与肢体协调。' },
  { id: 'cat_white', label: '白色是否成立', category: '白猫形象', maximum: 10, kind: 'visual', description: '猫的主体明显为白色，允许阴影、轮廓和少量彩色装饰。' },
  { id: 'bike_identity', label: '自行车是否清楚', category: '自行车结构', maximum: 10, kind: 'visual', description: '双轮、车架、车把和车座让人一眼认出自行车。' },
  { id: 'bike_connections', label: '部件连接是否合理', category: '自行车结构', maximum: 10, kind: 'visual', description: '轮轴、车架、前叉及脚踏连接可信，没有明显悬空或错接。' },
  { id: 'rider_support', label: '身体是否有支撑', category: '骑车关系', maximum: 10, kind: 'visual', description: '身体与车座或车架的支撑关系自然，像在骑车而非浮在车上。' },
  { id: 'front_paws', label: '前爪与车把', category: '骑车关系', maximum: 10, kind: 'visual', description: '前爪与车把位置合理，能看出扶把或控制自行车的关系。' },
  { id: 'rear_paws', label: '后爪与脚踏', category: '骑车关系', maximum: 10, kind: 'visual', description: '后爪、腿和脚踏构成合理骑姿；如有踩踏动作，接触关系连贯。' },
  { id: 'composition', label: '构图与比例', category: '画面完成度', maximum: 10, kind: 'visual', description: '主体清楚，猫与车比例协调，没有影响理解的遮挡或裁切。' },
  { id: 'visual_finish', label: '线条与配色', category: '画面完成度', maximum: 10, kind: 'visual', description: '线条、配色与细节协调，简洁画法也能满分。' },
  { id: 'html_render', label: '网页可以展示', category: '网页与 SVG', maximum: 5, kind: 'technical', description: '打开原始 HTML，确认浏览器能展示有效作品。' },
  { id: 'svg_source', label: '主体使用 SVG', category: '网页与 SVG', maximum: 5, kind: 'technical', description: '查看完整代码，确认猫和自行车主要由 SVG 绘制，而非嵌入现成图片。' },
] as const;
export const pelicanPrompt = '来一段白色猫咪骑自行车的html网页，用svg绘制';

const idSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const nonempty = z.string().trim().min(1);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, '日期无效');

// Legacy records remain a separate version. They cannot be mixed into the v3 task.
const legacyEntrySchema = z.object({
  id: idSchema,
  name: nonempty,
  providerId: z.enum(providerIds),
  tier: z.enum(['hang', 'top', 'good', 'npc', 'la']),
  order: z.number().int().positive(),
  gif: z.string().regex(/^media\/pelican\/[a-z0-9]+(?:-[a-z0-9]+)*\.gif$/, 'GIF 使用 public/media/pelican/ 下的本地文件'),
}).strict();

const criterionSchema = z.object({
  id: z.enum(pelicanCriteria.map(item => item.id) as [typeof pelicanCriteria[number]['id'], ...typeof pelicanCriteria[number]['id'][]]),
  score: z.number().finite().nonnegative().nullable(),
  reason: nonempty,
  evidenceTimes: z.array(z.number().finite().nonnegative()),
}).strict();

export const pelicanV3EntrySchema = z.object({
  id: idSchema,
  name: nonempty,
  providerId: z.enum(providerIds),
  ruleVersion: z.literal('3.0'),
  media: z.object({
    type: z.literal('video'),
    src: z.string().regex(/^media\/pelican\/[a-z0-9]+(?:-[a-z0-9]+)*\.mp4$/),
    poster: z.string().regex(/^media\/pelican\/[a-z0-9]+(?:-[a-z0-9]+)*\.webp$/),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }).strict(),
  test: z.object({
    modelLabel: nonempty,
    platform: nonempty.nullable(),
    effort: nonempty.nullable(),
    date: dateSchema.nullable(),
    tools: z.enum(['unknown', 'none', 'enabled']),
    codeModified: z.boolean().nullable(),
    identityStatus: z.enum(['submitted', 'verified']),
    firstAttempt: z.boolean().nullable().default(null),
    promptStatus: z.enum(['unknown', 'exact', 'variant']).default('unknown'),
    promptText: nonempty.nullable().default(null),
    notes: z.array(nonempty).default([]),
  }).strict(),
  assessment: z.object({
    status: z.enum(['provisional', 'verified']),
    reviewedAt: dateSchema,
    reviewer: z.literal('AI'),
    criteria: z.array(criterionSchema).length(pelicanCriteria.length),
    ownerConfirmed: z.boolean(),
  }).strict(),
}).strict().superRefine((entry, ctx) => {
  const ids = new Set<string>();
  entry.assessment.criteria.forEach((item, index) => {
    const path = ['assessment', 'criteria', index];
    if (ids.has(item.id)) ctx.addIssue({ code: 'custom', path: [...path, 'id'], message: '评分项不能重复或遗漏' });
    ids.add(item.id);
    const criterion = pelicanCriteria.find(criterion => criterion.id === item.id)!;
    if (item.score !== null && ![0, criterion.maximum / 2, criterion.maximum].includes(item.score)) {
      ctx.addIssue({ code: 'custom', path: [...path, 'score'], message: '每项只能给零分、半分或满分' });
    }
    if (entry.assessment.status === 'provisional' && criterion.kind === 'technical' && item.score !== null) {
      ctx.addIssue({ code: 'custom', path: [...path, 'score'], message: '待原作核验的作品不能先确认网页与 SVG 分数' });
    }
    if (entry.assessment.status === 'verified' && item.score === null) {
      ctx.addIssue({ code: 'custom', path: [...path, 'score'], message: '正式成绩必须完成全部评分项' });
    }
  });
  if (entry.media.src !== `media/pelican/${entry.id}.mp4` || entry.media.poster !== `media/pelican/${entry.id}.webp`) {
    ctx.addIssue({ code: 'custom', path: ['media'], message: '媒体文件名必须与作品 ID 一致' });
  }
  if (entry.test.promptStatus === 'variant' && entry.test.promptText === null) {
    ctx.addIssue({ code: 'custom', path: ['test', 'promptText'], message: '题目有差异时必须记录实际提示词' });
  }
  if (entry.test.promptStatus === 'exact' && entry.test.promptText !== null && entry.test.promptText !== pelicanPrompt) {
    ctx.addIssue({ code: 'custom', path: ['test', 'promptText'], message: '已确认同题的提示词必须与本批题目完全相同' });
  }
  if (entry.assessment.status === 'verified') {
    if (!entry.assessment.ownerConfirmed) ctx.addIssue({ code: 'custom', path: ['assessment', 'ownerConfirmed'], message: '正式成绩必须经过源宝复核' });
    if (entry.test.identityStatus !== 'verified' || entry.test.platform === null || entry.test.effort === null || entry.test.date === null || entry.test.tools === 'unknown' || entry.test.codeModified !== false || entry.test.firstAttempt !== true || entry.test.promptStatus !== 'exact') {
      ctx.addIssue({ code: 'custom', path: ['test'], message: '正式成绩需要核实型号、平台、档位、日期与工具条件，并确认同题首次生成、代码未修改' });
    }
  }
});

const legacyBoardSchema = z.object({ schemaVersion: z.literal(1), entries: z.array(legacyEntrySchema) }).strict();
const currentBoardSchema = z.object({ schemaVersion: z.literal(2), ruleVersion: z.literal('3.0'), entries: z.array(pelicanV3EntrySchema) }).strict();

export const pelicanSchema = z.union([legacyBoardSchema, currentBoardSchema]).superRefine((data, ctx) => {
  const ids = new Set<string>();
  const positions = new Set<string>();
  data.entries.forEach((entry, index) => {
    if (ids.has(entry.id)) ctx.addIssue({ code: 'custom', path: ['entries', index, 'id'], message: '测试条目 ID 不能重复' });
    ids.add(entry.id);
    if (!('ruleVersion' in entry)) {
      const position = `${entry.tier}:${entry.order}`;
      if (positions.has(position)) ctx.addIssue({ code: 'custom', path: ['entries', index, 'order'], message: '同一档位内的排序不能重复' });
      positions.add(position);
    }
  });
});

export type PelicanBoard = z.infer<typeof pelicanSchema>;
export type PelicanEntry = PelicanBoard['entries'][number];
export type PelicanV3Entry = z.infer<typeof pelicanV3EntrySchema>;
export function isPelicanV3Entry(entry: PelicanEntry): entry is PelicanV3Entry { return 'ruleVersion' in entry; }
export function isPelicanVerified(entry: PelicanEntry) { return !isPelicanV3Entry(entry) || entry.assessment.status === 'verified'; }

export function getPelicanScore(entry: PelicanV3Entry) {
  const visual = entry.assessment.criteria.filter(item => pelicanCriteria.find(criterion => criterion.id === item.id)!.kind === 'visual');
  return {
    visual: visual.every(item => item.score !== null) ? visual.reduce((sum, item) => sum + item.score!, 0) : null,
    visualCompleted: visual.filter(item => item.score !== null).length,
    total: entry.assessment.status === 'verified' ? entry.assessment.criteria.reduce((sum, item) => sum + item.score!, 0) : null,
  };
}

export function getPelicanTier(entry: PelicanEntry) {
  if (!isPelicanV3Entry(entry)) return entry.tier;
  const total = getPelicanScore(entry).total;
  return total === null ? null : pelicanTiers.find(tier => total >= tier.minimum)!.id;
}

export function getPelicanCounts(rows: PelicanEntry[]) {
  const verified = rows.filter(isPelicanVerified).length;
  return { total: rows.length, provisional: rows.length - verified, verified };
}

export interface PelicanFilters { providers: string[]; query: string; order: 'asc' | 'desc' }
export const defaultPelicanFilters: PelicanFilters = { providers: [], query: '', order: 'desc' };

export function parsePelicanFilters(search: string): PelicanFilters {
  const params = new URLSearchParams(search);
  return {
    order: params.get('order') === 'asc' ? 'asc' : 'desc',
    query: (params.get('q') ?? '').trim().slice(0, 100),
    providers: [...new Set((params.get('providers') ?? '').split(',').filter(id => providerIds.includes(id as typeof providerIds[number])))].sort(),
  };
}

export function serializePelicanFilters(filters: PelicanFilters) {
  const params = new URLSearchParams();
  if (filters.order === 'asc') params.set('order', 'asc');
  if (filters.providers.length) params.set('providers', [...filters.providers].sort().join(','));
  if (filters.query) params.set('q', filters.query);
  return params.size ? `?${params}` : '';
}

function compareFormal(a: PelicanEntry, b: PelicanEntry) {
  if (isPelicanV3Entry(a) && isPelicanV3Entry(b)) return getPelicanScore(b).total! - getPelicanScore(a).total!;
  if (!isPelicanV3Entry(a) && !isPelicanV3Entry(b)) {
    return pelicanTiers.findIndex(tier => tier.id === a.tier) - pelicanTiers.findIndex(tier => tier.id === b.tier) || a.order - b.order;
  }
  return 0;
}

export function getPelicanTiers(board: PelicanBoard) {
  return pelicanTiers.map(tier => ({
    ...tier,
    entries: board.entries.filter(entry => getPelicanTier(entry) === tier.id).sort(compareFormal),
  }));
}

export function getPelicanRows(board: PelicanBoard, catalog: Catalog, filters: PelicanFilters) {
  const matches = modelSearch(filters.query);
  const matched = board.entries.filter(entry => {
    const provider = catalog.providers.find(item => item.id === entry.providerId)!;
    return (!filters.providers.length || filters.providers.includes(entry.providerId)) &&
      matches(entry.name, provider.name, provider.shortName, entry.providerId, isPelicanV3Entry(entry) ? entry.test.modelLabel : '');
  });
  const formal = matched.filter(isPelicanVerified).sort((a, b) => filters.order === 'asc' ? compareFormal(b, a) : compareFormal(a, b));
  // Unverified observations are never ranked, including when the formal board is reversed.
  return [...formal, ...matched.filter(entry => !isPelicanVerified(entry))];
}

export function getPelicanRankGroups(rows: PelicanEntry[]) {
  const sorted = rows.filter(isPelicanVerified).sort(compareFormal);
  const groups: Array<{ rank: number; entries: PelicanEntry[] }> = [];
  sorted.forEach((entry, index) => {
    const previous = sorted[index - 1];
    if (previous && isPelicanV3Entry(entry) && isPelicanV3Entry(previous) && getPelicanScore(entry).total === getPelicanScore(previous).total) {
      groups.at(-1)!.entries.push(entry);
    } else groups.push({ rank: index + 1, entries: [entry] });
  });
  return groups;
}

export function getPelicanLeaders(rows: PelicanEntry[]) {
  return getPelicanRankGroups(rows).filter(group => group.rank <= 3).flatMap(group => group.entries);
}
