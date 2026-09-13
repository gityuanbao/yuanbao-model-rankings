import test from 'node:test';
import assert from 'node:assert/strict';
import official from '../data/performance/arena-text-2026-09-11.json';
import original from '../data/performance/initial-source.json';
import selectionData from '../data/performance/models.json';
import originalSelection from './fixtures/performance/initial-selection.json';
import { catalog } from '../src/lib/catalog';
import { arenaSource, performanceSnapshotSchema, selectionSchema } from '../src/lib/performance-schema';
import { defaultPerformanceFilters, getPerformanceRows } from '../src/lib/performance';
import { renderPerformanceMobile, renderPerformanceRows } from '../src/lib/performance-render';
import { acceptSnapshot, normalizeArena, parseArenaImport } from '../scripts/performance/arena';
import { providerFor, selectionFor } from '../scripts/performance/selection';

const selection=selectionSchema.parse(selectionData);
const now='2026-09-12T10:00:00.000Z';
const evidence=parseArenaImport(official);
const latest=normalizeArena(evidence.rows,selection,now,evidence.retrieval,evidence.sourceUrl);

test('完整官网证据收录 12 家厂商全部 241 条官方型号与配置，保留原有模型身份',()=>{
  assert.equal(evidence.rows.length,401);
  assert.equal(latest.models.length,241);
  assert.equal(new Set(latest.models.map(m=>m.providerId)).size,12);
  assert.deepEqual(new Set(latest.models.map(m=>m.sourceModel)),new Set(evidence.rows.filter(r=>providerFor(r.organization)).map(r=>r.model_name)));
  for(const m of latest.models){
    const source=evidence.rows.find(r=>r.model_name===m.sourceModel)!;
    assert.deepEqual([m.score,m.uncertainty,m.votes,m.sourceRank,m.preliminary],[source.rating,source.uncertainty,source.vote_count,source.rank,source.preliminary]);
  }
  for(const m of originalSelection.models)assert.equal(latest.models.find(row=>row.sourceModel===m.sourceModel)?.id,m.id);
});

test('GPT-6 Astra Max 保留官方 1478 分、2059 票与原榜第 24 名，不虚构其他档位',()=>{
  const astra=latest.models.filter(m=>m.sourceModel.includes('astra'));
  assert.equal(astra.length,1);
  assert.deepEqual([astra[0].name,astra[0].mode,astra[0].score,astra[0].votes,astra[0].sourceRank],['GPT-6 Astra','Max',1478,2059,24]);
  assert.ok(latest.models.some(m=>m.sourceModel==='grok-4.6-high'));
  assert.ok(latest.models.some(m=>m.sourceModel==='minimax-m2.7' && m.name==='MiniMax M2.7'));
});

test('官网相同整数分保留原榜先后，升降序和厂商筛选不改写名次',()=>{
  const rows=getPerformanceRows(latest,catalog,defaultPerformanceFilters);
  const equal=rows.filter(m=>m.score===1478);
  assert.ok(equal.length>1);
  assert.ok(equal.every(m=>!m.tied));
  assert.deepEqual(equal.map(m=>m.sourceRank),[...equal.map(m=>m.sourceRank)].sort((a,b)=>a-b));
  assert.equal(new Set(equal.map(m=>m.rank)).size,equal.length);
  assert.deepEqual(getPerformanceRows(latest,catalog,{...defaultPerformanceFilters,order:'asc'}),[...rows].reverse());
  const filtered=getPerformanceRows(latest,catalog,{...defaultPerformanceFilters,providers:['openai'],query:'Astra'});
  assert.equal(filtered.length,1);assert.equal(filtered[0].rank,rows.find(m=>m.sourceModel==='gpt-6-astra-max')!.rank);
});

test('将来新官方型号无需编辑固定清单，第三方仿名、微调及未知系列不纳入',()=>{
  // Deliberately fictional test models, never written to production data.
  const template=evidence.rows.find(r=>r.organization==='OpenAI')!;
  const newRows=[
    {...template,model_name:'gpt-99-high',rank:402},
    {...template,model_name:'gpt-99-community',rank:403},
    {...template,model_name:'gpt-99-uncensored',rank:404,organization:'Independent Labs'},
    {...template,model_name:'anonymous-model',rank:405},
  ];
  const next=normalizeArena([...evidence.rows,...newRows],selection,now,evidence.retrieval,evidence.sourceUrl);
  assert.equal(next.models.length,latest.models.length+1);
  assert.equal(next.models.at(-1)?.sourceModel==='anonymous-model',false);
  assert.equal(next.models.find(m=>m.sourceModel==='gpt-99-high')?.mode,'High');
  assert.ok(acceptSnapshot(latest,next));
});

test('版本标点产生相同 slug 时身份仍独立，推理模式可追溯',()=>{
  const a=selectionFor('gpt-99.1-high','openai',selection)!;
  const b=selectionFor('gpt-99-1-high','openai',selection)!;
  assert.notEqual(a.id,b.id);
  assert.equal(a.mode,'High');assert.equal(a.sourceModel,'gpt-99.1-high');
  assert.equal(selectionFor('gpt-99.1-high','google',selection),undefined);
});

test('Qwen Max 保留产品全名，新版本不会被误拆为推理档位',()=>{
  const qwen=latest.models.find(model=>model.sourceModel==='qwen2.5-max')!;
  assert.equal(qwen.name,'Qwen2.5 Max');
  assert.equal(qwen.mode,undefined);
  assert.equal(qwen.id,'arena-qwen2-5-max-142b48f4');
  // Fictional future versions test the family rule without creating live data.
  const future=selectionFor('qwen99-max','alibaba',selection)!;
  assert.equal(future.name,'Qwen99 Max');assert.equal(future.mode,undefined);
  const configured=selectionFor('qwen99-max-high','alibaba',selection)!;
  assert.equal(configured.name,'Qwen99 Max');assert.equal(configured.mode,'High');
  for(const [name,provider] of [['gpt-99-max','openai'],['claude-fable-99-max','anthropic'],['glm-99-max','zhipu']]){
    assert.equal(selectionFor(name,provider,selection)?.mode,'Max');
  }
});

test('官网导入拒绝少行、乱序、错日期、伪造精度或非官方来源',()=>{
  for(const input of [
    {...official,rows:official.rows.slice(1)},
    {...official,rows:[...official.rows].reverse()},
    {...official,publishedAt:'2026-09-02'},
    {...official,rows:[{...official.rows[0],score_precision:undefined},...official.rows.slice(1)]},
    {...official,sourceUrl:'https://example.com/leaderboard'},
  ])assert.throws(()=>parseArenaImport(input));
});

test('同份快照不可混用整数和精确分，也不能补造精确区间',()=>{
  const mixed=structuredClone(latest);
  const first=mixed.models[0];delete first.scorePrecision;
  first.lower=first.score-1;first.upper=first.score+1;
  assert.throws(()=>performanceSnapshotSchema.parse(mixed),/不可混用/);
  const falseBounds=structuredClone(latest);falseBounds.models[0].lower=falseBounds.models[0].score-5;
  assert.throws(()=>performanceSnapshotSchema.parse(falseBounds),/不能推测/);
  assert.throws(()=>performanceSnapshotSchema.parse({...latest,sourceUrl:arenaSource.url}),/注明官网/);
});

test('桌面和移动端使用官网整数分、原始 ± 区间及初步成绩提示',()=>{
  const row=getPerformanceRows(latest,catalog,{...defaultPerformanceFilters,query:'Astra'})[0];
  for(const render of [renderPerformanceRows,renderPerformanceMobile]){
    const html=render([{...row,preliminary:true}],catalog,'/model-prices/');
    assert.match(html,/>1478<\/strong>/);assert.doesNotMatch(html,/1478\.0/);
    assert.match(html,/± 13/);assert.match(html,/初步成绩/);
    assert.match(html,/https:\/\/arena.ai\/leaderboard\/text/);
    assert.match(html,/\/model-prices\/logos\/openai.svg/);
  }
});

test('新快照追加时旧快照保持原样，重复导入不变更，旧导出和静默删新型号被阻止',()=>{
  const old=normalizeArena(original.rows,selectionSchema.parse(originalSelection),now,'reviewed-official-view');
  const before=JSON.stringify(old);assert.equal(acceptSnapshot(old,latest),true);
  assert.equal(JSON.stringify(old),before);
  assert.equal(acceptSnapshot(latest,{...latest,retrievedAt:'2026-09-12T11:00:00.000Z'}),false);
  assert.throws(()=>acceptSnapshot(latest,old),/倒退/);
  assert.throws(()=>acceptSnapshot(latest,{...latest,models:latest.models.filter(m=>m.sourceModel!=='gpt-6-astra-max')}),/删除/);
});

test('未来完整 API 数据可整体替换官网取整分，保持全部 241 个模型身份',()=>{
  // Simulated later API export to exercise precision changes, not live source evidence.
  const apiRows=evidence.rows.map(({score_precision,uncertainty,preliminary,...row})=>({...row,rating:row.rating+0.1,rating_lower:row.rating-1,rating_upper:row.rating+1,leaderboard_publish_date:'2026-09-12'}));
  const next=normalizeArena(apiRows,selection,now);
  assert.equal(acceptSnapshot(latest,next),true);
  assert.equal(next.models.length,241);
  assert.ok(next.models.every(m=>m.scorePrecision===undefined && m.lower!==null));
  assert.equal(next.sourceUrl,arenaSource.url);
  assert.deepEqual(new Set(next.models.map(m=>m.id)),new Set(latest.models.map(m=>m.id)));
});
