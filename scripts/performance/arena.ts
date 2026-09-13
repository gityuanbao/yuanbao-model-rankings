import { z } from 'zod';
import { arenaSource, performanceSnapshotSchema, selectionSchema, type PerformanceSelection, type PerformanceSnapshot } from '../../src/lib/performance-schema';
import { providerFor, selectionFor } from './selection';

const rawRowSchema = z.object({
  model_name:z.string().min(1), organization:z.string().min(1), category:z.literal('overall'),
  rating:z.number().finite().positive(), rating_lower:z.number().finite().positive().nullable(), rating_upper:z.number().finite().positive().nullable(),
  score_precision:z.literal('rounded').optional(), uncertainty:z.number().finite().nonnegative().optional(), preliminary:z.boolean().optional(),
  vote_count:z.number().int().positive(), rank:z.number().int().positive(), leaderboard_publish_date:z.string(),
});
export function parseArenaImport(input:unknown) {
  const imported=z.object({sourceUrl:z.enum([arenaSource.url,arenaSource.leaderboardUrl]),rows:z.array(rawRowSchema).min(1),sourceRowCount:z.number().int().positive().optional(),publishedAt:z.string().optional()}).parse(input);
  const officialPage=imported.sourceUrl===arenaSource.leaderboardUrl;
  if(officialPage && (imported.rows.length!==imported.sourceRowCount || !imported.rows.every((row,i)=>row.rank===i+1 && row.score_precision==='rounded' && row.leaderboard_publish_date===imported.publishedAt))) throw new Error('官网记录必须完整、日期一致，并保留整数分与全部原榜名次');
  return {...imported,retrieval:officialPage?'reviewed-official-page' as const:'reviewed-official-view' as const};
}
export function normalizeArena(raw:unknown[], selection:PerformanceSelection, now:string, retrieval:PerformanceSnapshot['retrieval']='official-api', sourceUrl:PerformanceSnapshot['sourceUrl']=arenaSource.url):PerformanceSnapshot {
  selectionSchema.parse(selection);
  if (!raw.length) throw new Error('官方榜单为空，保留有效快照');
  const rows = raw.map(row => rawRowSchema.parse(row));
  if (new Set(rows.map(r=>r.model_name)).size !== rows.length) throw new Error('官方榜单存在重复模型');
  if (new Set(rows.map(r=>r.leaderboard_publish_date)).size !== 1) throw new Error('分页期间榜单发生变化，拒绝混合日期');
  for(const model of selection.models)if(!rows.some(row=>row.model_name===model.sourceModel))throw new Error(`官方榜单缺少 ${model.sourceModel}，需核对版本，保留有效快照`);
  const selected=rows.flatMap(row=>{
    const provider=providerFor(row.organization);
    const configured=selection.models.find(m=>m.sourceModel===row.model_name);
    if(configured && configured.providerId!==provider)throw new Error(`${row.model_name} 厂商不匹配`);
    const match=provider?selectionFor(row.model_name,provider,selection):undefined;
    return match?[match]:[];
  });
  const models = selected.map(model => {
    const row = rows.find(r=>r.model_name === model.sourceModel);
    if (!row) throw new Error(`官方榜单缺少 ${model.sourceModel}，需核对版本，保留有效快照`);
    return {...model, score:row.rating, lower:row.rating_lower, upper:row.rating_upper, votes:row.vote_count, sourceRank:row.rank,...(row.score_precision?{scorePrecision:row.score_precision,uncertainty:row.uncertainty,preliminary:row.preliminary ?? false}:{})};
  }).sort((a,b)=>b.score-a.score || a.id.localeCompare(b.id));
  return performanceSnapshotSchema.parse({schemaVersion:1, sourceId:arenaSource.id, publishedAt:rows[0].leaderboard_publish_date, retrievedAt:now, retrieval, sourceUrl, sourceRowCount:rows.length, models});
}

const pageSchema = z.object({
  num_rows_total:z.number().int().positive().max(5000),
  rows:z.array(z.object({row:z.unknown(), truncated_cells:z.array(z.unknown()).max(0)})).min(1),
});
export async function fetchArena(fetcher:typeof fetch=fetch):Promise<unknown[]> {
  const rows:unknown[]=[];
  let total:number|undefined;
  for (let offset=0; total === undefined || offset<total; offset+=100) {
    const url = new URL('https://datasets-server.huggingface.co/filter');
    url.search = new URLSearchParams({dataset:arenaSource.dataset, config:arenaSource.config, split:'latest', where:'"category"=\'overall\'', offset:String(offset), length:'100'}).toString();
    const response = await fetcher(url, {signal:AbortSignal.timeout(20_000), redirect:'error', headers:{Accept:'application/json'}});
    if (!response.ok) throw new Error(`Arena 数据接口 HTTP ${response.status}`);
    const text = await response.text();
    if (text.length>2_000_000) throw new Error('Arena 单页响应过大');
    const page = pageSchema.parse(JSON.parse(text));
    if (total !== undefined && total !== page.num_rows_total) throw new Error('分页期间榜单数量发生变化');
    total = page.num_rows_total;
    if (page.rows.length !== Math.min(100,total-offset)) throw new Error('Arena 分页不完整');
    rows.push(...page.rows.map(r=>r.row));
  }
  return rows;
}

export function acceptSnapshot(previous:PerformanceSnapshot | null, candidate:PerformanceSnapshot) {
  performanceSnapshotSchema.parse(candidate);
  if (!previous) return true;
  if (candidate.publishedAt < previous.publishedAt) throw new Error('来源日期倒退，保留当前榜单');
  for (const model of previous.models) {
    const next = candidate.models.find(m=>m.id === model.id);
    if (!next) throw new Error('收录模型被删除，需人工核对');
    if (next.sourceModel !== model.sourceModel || next.providerId !== model.providerId) throw new Error('模型映射改变，需人工核对');
    if (Math.abs(next.score-model.score)>100) throw new Error(`${model.name} 得分变化超过 100 分，需人工核对评测口径`);
  }
  return JSON.stringify([previous.publishedAt,previous.models]) !== JSON.stringify([candidate.publishedAt,candidate.models]);
}
