import { z } from 'zod';
import { arenaSource, performanceSnapshotSchema, selectionSchema, type PerformanceSelection } from '../../src/lib/performance-schema';
import { parseLeaderboardHtml, parseMainstreamModelCell } from './categories';
import { selectionFor } from './selection';
import { PerformanceReviewError } from './diagnostics';

const headers = ['Rank', 'Rank Spread', 'Model', 'Score', 'Votes', 'Price $/M', 'Context'];
export const arenaPageSchema = z.object({
  category: z.literal('text'), sourceUrl: z.literal(arenaSource.leaderboardUrl),
  publishedAt: z.string(), sourceRowCount: z.number().int().positive().max(5000),
  headers: z.array(z.string()), rows: z.array(z.array(z.string())).min(1),
}).superRefine((data, ctx) => {
  if (JSON.stringify(data.headers) !== JSON.stringify(headers)) ctx.addIssue({ code:'custom', message:'官方文本表格列发生变化，需人工核对' });
  if (data.rows.length !== data.sourceRowCount || data.rows.some((row, index) => row.length !== headers.length || !new RegExp(`^${index + 1}(?: |$)`).test(row[0]))) {
    ctx.addIssue({ code:'custom', message:'官方文本记录必须完整且保留全部原榜名次' });
  }
});
export type ArenaPage = z.infer<typeof arenaPageSchema>;

export function parseArenaPageHtml(html: string): ArenaPage {
  return arenaPageSchema.parse(parseLeaderboardHtml(html, 'text'));
}

export async function fetchArenaPage(fetcher: typeof fetch = fetch): Promise<ArenaPage> {
  const response = await fetcher(arenaSource.leaderboardUrl, { signal:AbortSignal.timeout(20_000), redirect:'error', headers:{ Accept:'text/html' } });
  if (!response.ok) throw new Error(`Arena text 官网 HTTP ${response.status}`);
  const html = await response.text();
  if (html.length > 8_000_000) throw new Error('官方文本页面响应过大');
  return parseArenaPageHtml(html);
}

// This produces an independent, whole-page snapshot. It never fills a failed
// API response with page rows or copies previous scores into missing slots.
export function normalizeArenaPage(input: unknown, selection: PerformanceSelection, now: string) {
  const data = arenaPageSchema.parse(input);
  selectionSchema.parse(selection);
  const models = data.rows.flatMap(cells => {
    const score = cells[3].replace(/\s+/g, '').match(/^(\d+)(?:±(\d+)|\+(\d+)\/-(\d+))(Preliminary)?$/);
    if (!score || (score[3] && score[3] !== score[4])) throw new Error('官方文本评分格式或非对称区间需人工核对');
    if (!/^(?:\d{1,3}(?:,\d{3})*|\d+)$/.test(cells[4])) throw new Error('官方文本票数格式异常');
    const votes = Number(cells[4].replaceAll(',', ''));
    if (!Number.isSafeInteger(votes) || votes <= 0 || Number(score[1]) <= 0) throw new Error('官方文本分数或票数无效');
    const identity = parseMainstreamModelCell(cells[2]);
    if (!identity) return [];
    // Text names, including spaces and parenthesized configurations, match the
    // dataset names exactly. Do not apply Agent display-name normalization.
    const configured = selection.models.find(model => model.sourceModel === identity.sourceModel);
    if (configured && configured.providerId !== identity.providerId) throw new Error(`${identity.sourceModel} 厂商不匹配`);
    const model = selectionFor(identity.sourceModel, identity.providerId, selection);
    if (!model) return [];
    return [{ ...model, score:Number(score[1]), lower:null, upper:null,
      scorePrecision:'rounded' as const, uncertainty:Number(score[2] ?? score[3]), preliminary:!!score[5],
      votes, sourceRank:Number(cells[0].split(' ')[0]) }];
  }).sort((a,b) => b.score-a.score || a.id.localeCompare(b.id));
  const missing = selection.models.filter(model => !models.some(next => next.sourceModel === model.sourceModel));
  if (missing.length) throw new PerformanceReviewError(`官方文本页缺少收录型号，需人工核对：${missing.slice(0,8).map(model => model.sourceModel).join('、')}`, {
    kind:'missing_configured_models', missingModels:missing.map(({id,sourceModel,providerId}) => ({id,sourceModel,providerId})),
  });
  return performanceSnapshotSchema.parse({ schemaVersion:1, sourceId:arenaSource.id, sourceUrl:arenaSource.leaderboardUrl,
    publishedAt:data.publishedAt, retrievedAt:now, retrieval:'official-page', sourceRowCount:data.sourceRowCount, models });
}
