import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import source from '../data/performance/initial-source.json';
import selectionData from './fixtures/performance/initial-selection.json';
import { catalog } from '../src/lib/catalog';
import { selectionSchema } from '../src/lib/performance-schema';
import { defaultPerformanceFilters, getPerformanceRows, parsePerformanceFilters, serializePerformanceFilters } from '../src/lib/performance';
import { renderPerformanceRows, renderPerformanceMobile } from '../src/lib/performance-render';
import { acceptSnapshot, fetchArena, normalizeArena } from '../scripts/performance/arena';
import { stageAndValidate } from '../scripts/pricing/io';

const selection=selectionSchema.parse(selectionData);
const now='2026-09-12T10:00:00.000Z';
// Fixed official evidence, independent of the changing production snapshot.
const snapshot=normalizeArena(source.rows,selection,now,'reviewed-official-view');
test('官方视图导入保持原始得分、票数、模式和原榜名次，只收录 30 款白名单模型',()=>{
  const normalized=normalizeArena(source.rows,selection,now,'reviewed-official-view');
  assert.deepEqual(normalized.models,snapshot.models);
  assert.equal(normalized.models.length,30);
  assert.equal(new Set(normalized.models.map(m=>m.providerId)).size,12);
  for(const model of normalized.models){const raw=source.rows.find(r=>r.model_name===model.sourceModel)!;assert.equal(model.score,raw.rating);assert.equal(model.sourceRank,raw.rank);assert.equal(model.votes,raw.vote_count);}
  assert.ok(!normalized.models.some(m=>m.sourceModel.includes('inkling') || m.sourceModel.startsWith('mimo')));
});
test('缺失模型、错误厂商、重复记录、混合日期、零分、空值、置信区间异常均拒绝',()=>{
  assert.throws(()=>normalizeArena(source.rows.slice(1),selection,now),/缺少/);
  const mutations=[{organization:'unknown'},{rating:0},{rating:null},{rating:NaN},{rating_lower:9999},{leaderboard_publish_date:'2026-09-01'}];
  for(const patch of mutations)assert.throws(()=>normalizeArena([{...source.rows[0],...patch},...source.rows.slice(1)],selection,now));
  assert.throws(()=>normalizeArena([...source.rows,source.rows[0]],selection,now),/重复/);
  assert.throws(()=>normalizeArena([],selection,now),/为空/);
});
test('抓取时间或来源记录总数变化不生成空快照',()=>{
  assert.equal(acceptSnapshot(snapshot,{...snapshot,retrievedAt:now,sourceRowCount:399,retrieval:'official-api'}),false);
});
test('官方得分变化或新一期榜单会生成快照，不修改之前的数据',()=>{
  const original=JSON.stringify(snapshot);
  const changed=structuredClone(snapshot);changed.models[0].score+=1;
  assert.equal(acceptSnapshot(snapshot,changed),true);
  assert.equal(acceptSnapshot(snapshot,{...snapshot,publishedAt:'2026-09-03'}),true);
  assert.equal(JSON.stringify(snapshot),original);
});
test('日期倒退、模型丢失、评分口径大幅变化会阻止发布',()=>{
  assert.throws(()=>acceptSnapshot(snapshot,{...snapshot,publishedAt:'2026-09-01'}),/倒退/);
  assert.throws(()=>acceptSnapshot(snapshot,{...snapshot,models:snapshot.models.slice(1)}),/删除/);
  const changed=structuredClone(snapshot);changed.models[0].score+=101;changed.models[0].upper=changed.models[0].upper!+101;
  assert.throws(()=>acceptSnapshot(snapshot,changed),/超过 100 分/);
});
test('高低排序只改变顺序，名次和原榜名次保持不变',()=>{
  const descending=getPerformanceRows(snapshot,catalog,defaultPerformanceFilters);
  const ascending=getPerformanceRows(snapshot,catalog,{...defaultPerformanceFilters,order:'asc'});
  assert.deepEqual(ascending,[...descending].reverse());
  assert.equal(descending[0].rank,1);
  const filtered=getPerformanceRows(snapshot,catalog,{...defaultPerformanceFilters,providers:['openai']});
  assert.equal(filtered.length,4);
  assert.ok(filtered.every(m=>m.rank===descending.find(d=>d.id===m.id)!.rank));
});
test('中文厂商、型号和推理模式均可搜索，未知模型显示空列表',()=>{
  for(const query of ['智谱','gpt5.6','high'])assert.ok(getPerformanceRows(snapshot,catalog,{...defaultPerformanceFilters,query}).length>0);
  assert.equal(getPerformanceRows(snapshot,catalog,{...defaultPerformanceFilters,query:'不存在的模型'}).length,0);
});
test('并列得分共享名次，下一名保留空位；显示四舍五入不会合并不同原始得分',()=>{
  const clone=structuredClone(snapshot);clone.models[1].score=clone.models[0].score;
  const rows=getPerformanceRows(clone,catalog,defaultPerformanceFilters);
  assert.deepEqual(rows.slice(0,3).map(r=>r.rank),[1,1,3]);assert.ok(rows[0].tied);
  clone.models[1].score=clone.models[0].score-0.001;
  assert.deepEqual(getPerformanceRows(clone,catalog,defaultPerformanceFilters).slice(0,2).map(r=>r.rank),[1,2]);
});
test('URL 筛选可分享恢复，并过滤恶意或未知参数',()=>{
  const parsed=parsePerformanceFilters('?order=asc&providers=openai,unknown,google,openai&q=GPT-5.6');
  assert.deepEqual(parsePerformanceFilters(serializePerformanceFilters(parsed)),parsed);
  assert.deepEqual(parsed.providers,['google','openai']);
  assert.equal(parsePerformanceFilters('?order=bad').order,'desc');
  assert.equal(parsePerformanceFilters('?q='+ 'a'.repeat(200)).query.length,100);
});
test('表格和移动卡片使用本地彩色 logo、部署子路径并转义文本',()=>{
  const row=getPerformanceRows(snapshot,catalog,defaultPerformanceFilters)[0];
  for(const render of [renderPerformanceRows,renderPerformanceMobile]){
    const html=render([{...row,name:'<script>alert(1)</script>'}],catalog,'/model-prices/');
    assert.match(html,/\/model-prices\/logos\/anthropic.svg/);assert.doesNotMatch(html,/<script>/);assert.match(html,/&lt;script&gt;/);
    assert.match(html,/noopener noreferrer/);
  }
});
test('API 请求获取完整分页，显式选择风格控制文本 overall 而非 Agent 分数',async()=>{
  const records=[...source.rows,{...source.rows[0],model_name:'extra-model'}];
  let calls=0;
  const fake=async(input:RequestInfo|URL)=>{
    const url=new URL(String(input));assert.equal(url.searchParams.get('config'),'text_style_control');assert.equal(url.searchParams.get('where'),'"category"=\'overall\'');
    const offset=Number(url.searchParams.get('offset'));calls++;
    return Response.json({num_rows_total:101,rows:records.slice(offset,offset+100).map(row=>({row,truncated_cells:[]}))});
  };
  assert.equal((await fetchArena(fake as typeof fetch)).length,101);assert.equal(calls,2);
});
test('超时、HTTP 错误、分页缺项、被截断的字段和分页变化均保留旧数据',async()=>{
  const failing=[
    async()=>{throw new Error('timeout');},async()=>new Response('blocked',{status:403}),
    async()=>Response.json({num_rows_total:399,rows:source.rows.slice(0,2).map(row=>({row,truncated_cells:[]}))}),
    async()=>Response.json({num_rows_total:1,rows:[{row:source.rows[0],truncated_cells:['rating']}]}),
  ];
  for(const fetcher of failing)await assert.rejects(fetchArena(fetcher as typeof fetch));
  let call=0;
  await assert.rejects(fetchArena((async()=>Response.json({num_rows_total:++call===1?101:102,rows:source.rows.map(row=>({row,truncated_cells:[]}))})) as typeof fetch),/数量发生变化/);
});
test('构建失败时同时回滚当前成绩和历史，成功时追加保留原快照',async()=>{
  const root=await mkdtemp(join(tmpdir(),'yuanbao-performance-'));
  try {
    await writeFile(join(root,'current.json'),JSON.stringify(snapshot));
    await writeFile(join(root,'history.json'),JSON.stringify([snapshot]));
    const next={...snapshot,publishedAt:'2026-09-03'};
    const files={'current.json':JSON.stringify(next),'history.json':JSON.stringify([snapshot,next])};
    await assert.rejects(stageAndValidate(root,files,async()=>{throw new Error('build failed');}),/build failed/);
    assert.deepEqual(JSON.parse(await readFile(join(root,'current.json'),'utf8')),snapshot);
    assert.deepEqual(JSON.parse(await readFile(join(root,'history.json'),'utf8')),[snapshot]);
    await stageAndValidate(root,files,async()=>{});
    assert.deepEqual(JSON.parse(await readFile(join(root,'history.json'),'utf8')),[snapshot,next]);
  } finally {await rm(root,{recursive:true,force:true});}
});
