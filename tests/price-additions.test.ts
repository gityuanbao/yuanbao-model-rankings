import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fixtureCatalog } from './fixtures/catalog';
import additions from '../data/pricing/reviewed-additions-2026-09-12.json';
import { addReviewedModels } from '../scripts/pricing/add-reviewed';
import { hash, meaningfulCatalog, officialPrice, stable } from '../scripts/pricing/diff';
import { type PriceHistory, type VerificationFile } from '../src/lib/pricing-metadata';
import { defaultFilters, getRows, quote } from '../src/lib/ranking';
import qwen from '../scripts/providers/qwen';
import minimax from '../scripts/providers/minimax';

const now='2026-09-13T00:00:00.000Z';
const initial=()=>{
  const catalog=structuredClone(fixtureCatalog);
  const history:PriceHistory={schemaVersion:1,models:catalog.models.map(m=>({modelId:m.id,providerId:m.providerId,events:[{id:hash(m.id),detectedAt:'2026-09-12T00:00:00.000Z',effectiveAt:null,currency:m.currency,rates:m.rates,sourceUrl:catalog.sources.find(s=>s.id===m.sourceId)!.url,reason:'initial_snapshot',verification:'manual_verified',changeTypes:[]}]}))};
  const verification:VerificationFile={schemaVersion:1,checkedAt:'2026-09-12T00:00:00.000Z',providers:{},models:{},catalogHash:hash(meaningfulCatalog(catalog))};
  return {catalog,history,verification};
};

test('核价清单新增 31 个型号及初始历史，原价格和全部历史保持不变',()=>{
  const current=initial(),before=structuredClone(current);
  const next=addReviewedModels(current,additions,now);
  assert.equal(next.added.length,31);assert.equal(next.catalog.models.length,55);
  assert.deepEqual(current,before);
  assert.deepEqual(next.catalog.models.slice(0,24),current.catalog.models);
  assert.deepEqual(next.history.models.slice(0,24),current.history.models);
  for(const id of next.added){
    const model=next.catalog.models.find(m=>m.id===id)!;
    const events=next.history.models.find(m=>m.modelId===id)!.events;
    assert.equal(events.length,1);assert.equal(events[0].reason,'initial_snapshot');
    assert.equal(events[0].effectiveAt,null);assert.equal(events[0].verification,'manual_verified');
    assert.equal(stable(officialPrice(events[0])),stable(officialPrice(model)));
  }
});

test('重复导入逐字段不变，不追加历史或修改核验时间',()=>{
  const once=addReviewedModels(initial(),additions,now);
  const twice=addReviewedModels(once,additions,'2026-09-14T00:00:00.000Z');
  assert.deepEqual(twice.added,[]);
  for(const key of ['catalog','history','verification'] as const)assert.deepEqual(twice[key],once[key]);
});

test('新增入口拒绝覆盖旧模型价格，也拒绝 API 同地区重复',()=>{
  const once=addReviewedModels(initial(),additions,now);
  const changed=structuredClone(additions);changed.models[0].model.rates[0].input=1;
  assert.throws(()=>addReviewedModels(once,changed,now),/不得绕过价格 Diff/);
  const duplicate=structuredClone(additions);duplicate.models[0].model.id='different-name-same-api';
  assert.throws(()=>addReviewedModels(once,duplicate,now),/API 型号与地区重复/);
});

test('未来核验、非官方来源、搜索索引、零价及重复 ID 被阻止',()=>{
  const patches=[
    (data:any)=>{data.reviewedAt='2099-01-01T00:00:00.000Z';},
    (data:any)=>{data.sources[0].url='https://example.com/prices';},
    (data:any)=>{data.sources[0].retrieval='search-index';},
    (data:any)=>{data.models[0].model.rates[0].input=0;data.models[0].model.zeroPriceReason='占位';},
    (data:any)=>{data.models.push(structuredClone(data.models[0]));},
  ];
  for(const patch of patches){const data=structuredClone(additions);patch(data);assert.throws(()=>addReviewedModels(initial(),data,now));}
});

test('Astra 原币价格及 272K 边界正确，缓存和 Batch 必须主动开启',()=>{
  const model=addReviewedModels(initial(),additions,now).catalog.models.find(m=>m.id==='gpt-6-astra')!;
  const a=quote(model,{...defaultFilters,inputTokens:272000},1)!;
  const b=quote(model,{...defaultFilters,inputTokens:272001},1)!;
  assert.deepEqual([a.input,a.output,a.cache],[10,50,1]);
  assert.deepEqual([b.input,b.output,b.cache],[20,75,2]);
  assert.equal(quote(model,{...defaultFilters},7)!.task,.42);
  assert.equal(quote(model,{...defaultFilters,billing:'batch'},1)!.input,5);
  assert.equal(quote(model,{...defaultFilters,billing:'cache',cachePercent:100},1)!.input,1);
  assert.equal(quote(model,{...defaultFilters,inputTokens:1050000,outputTokens:1},1),null);
});

test('Google 输入限制不误当输入输出之和，Pro 200K 与 MiniMax 512K 分档正确',()=>{
  const next=addReviewedModels(initial(),additions,now);
  const google=next.catalog.models.find(m=>m.id==='gemini-3-1-pro-preview')!;
  assert.ok(quote(google,{...defaultFilters,inputTokens:1048576,outputTokens:65536},1));
  assert.equal(quote(google,{...defaultFilters,inputTokens:200001},1)!.output,18);
  const m3=next.catalog.models.find(m=>m.id==='minimax-m3')!;
  assert.equal(quote(m3,{...defaultFilters,inputTokens:512000},1)!.input,2.1);
  assert.equal(quote(m3,{...defaultFilters,inputTokens:512001},1)!.input,4.2);
});

test('三类价格排序包含新增型号，倒序不改名次，保留人民币折算',()=>{
  const next=addReviewedModels(initial(),additions,now).catalog;
  for(const metric of ['input','output','task'] as const){
    const low=getRows(next,{...defaultFilters,metric,providers:['openai']}).rows;
    const high=getRows(next,{...defaultFilters,metric,providers:['openai'],order:'desc'}).rows;
    assert.ok(low.some(r=>r.model.id==='gpt-6-astra'));
    assert.deepEqual(high.map(r=>r.model.id),[...low].reverse().map(r=>r.model.id));
    assert.equal(high[0].rank,low.at(-1)!.rank);
  }
});

async function qwenEvidence(){const body=await readFile('tests/fixtures/providers/alibaba-expanded.html','utf8');return {providerId:'alibaba' as const,url:qwen.sourceUrl,body,fetchedAt:additions.reviewedAt,sha256:hash(body)};}
const qwenModels=()=>addReviewedModels(initial(),additions,now).catalog.models.filter(m=>additions.models.some(r=>r.model.id===m.id)&&m.providerId==='alibaba');
test('Qwen 新增九款完整阶梯从官方表解析，原价标签不误读为限时折扣',async()=>{
  const parsed=qwen.parse(await qwenEvidence(),qwenModels());
  assert.deepEqual(parsed.issues,[]);assert.equal(parsed.items.length,9);
  for(const item of parsed.items)assert.deepEqual(item.rates,qwenModels().find(m=>m.id===item.modelId)!.rates);
  assert.equal(parsed.items.find(m=>m.apiId==='qwen3.7-plus')!.rates[0].input,2);
});

test('Qwen 拒绝模式价不一致、无标签多数字，以及缺失的中间阶梯',async()=>{
  const evidence=await qwenEvidence();
  for(const body of [evidence.body.replace('<td>原价 8 元 （限时 8 折）</td>','<td>原价 9 元 （限时 8 折）</td>'),evidence.body.replace('原价 2 元 （限时 8 折）','2 元 1.6 元'),evidence.body.replaceAll('32K&lt;Token≤128K','40K&lt;Token≤128K')])assert.ok(qwen.parse({...evidence,body},qwenModels()).issues.length>0);
});

test('M3 不套用 M2 单档解析器，失败保留已核价的两档',()=>{
  const model=addReviewedModels(initial(),additions,now).catalog.models.find(m=>m.id==='minimax-m3')!;
  const body='<h1>按量标准服务</h1><table><tr><td>模型</td><td>输入价格 元/百万 tokens</td><td>输出价格 元/百万 tokens</td><td>缓存读取 元/百万 tokens</td></tr><tr><td>MiniMax-M3</td><td>2.1</td><td>8.4</td><td>0.42</td></tr></table>';
  const parsed=minimax.parse({providerId:'minimax',url:minimax.sourceUrl,body,fetchedAt:now,sha256:hash(body)},[model]);
  assert.equal(parsed.items.length,0);assert.match(parsed.issues[0].reason,/人工核验/);assert.equal(model.rates.length,2);
});
