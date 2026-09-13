import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fixtureCatalog as catalog, fixtureHistory as baseHistory, fixtureVerification as baseVerification } from './fixtures/catalog';
import { evaluateUpdates } from '../scripts/pricing/pipeline';
import { diffPrice } from '../scripts/pricing/diff';
import { withLock, stageAndValidate } from '../scripts/pricing/io';
import { normalizedPriceSchema, type NormalizedPrice, type ProviderRun } from '../scripts/pricing/types';
import { getRows, defaultFilters } from '../src/lib/ranking';
const now='2026-09-12T12:00:00.000Z';
const model=(id='minimax-m2-7')=>structuredClone(catalog.models.find(m=>m.id===id)!);
function candidate(id='minimax-m2-7',factor=1):NormalizedPrice {const m=model(id);return {modelId:m.id,providerId:m.providerId,apiId:m.apiId,currency:m.currency,unit:'per_1m_tokens',sourceUrl:catalog.sources.find(s=>s.id===m.sourceId)!.url,rates:m.rates.map(r=>({...r,input:Number((r.input*factor).toPrecision(12)),output:Number((r.output*factor).toPrecision(12))})),effectiveAt:null,evidence:{modelLabel:m.apiId,unitLabel:'per 1M tokens',inputLabel:'standard input',outputLabel:'output',standardLabel:'standard',structure:'test-table-v1',pageSha256:'a'.repeat(64),excerpt:`${m.apiId} 标准输入与输出价格`}};}
function run(items:NormalizedPrice[],patch:Partial<ProviderRun>={}):ProviderRun{return {providerId:items[0]?.providerId??'minimax',mode:'automatic',checkedAt:now,parsed:{items,issues:[],discoveries:[]},...patch};}
function evaluate(items:NormalizedPrice[],options:Partial<Parameters<typeof evaluateUpdates>[0]>={}) {const all=catalog.models.filter(m=>m.providerId===items[0]?.providerId&&m.status!=='retired').map(m=>items.find(i=>i.modelId===m.id)??candidate(m.id));all.push(...items.filter(i=>!catalog.models.some(m=>m.id===i.modelId)));return evaluateUpdates({catalog,history:baseHistory,verification:baseVerification,runs:[run(all)],now,...options});}
for(const [factor,label] of [[.8,'降价 20%'],[1.1,'涨价 10%']] as const)test(`${label} 自动更新，保存旧价并重排`,()=>{
  const result=evaluate([candidate('minimax-m2-7',factor)]);assert.equal(result.applied.length,1);assert.equal(result.dataChanged,true);
  const updated=result.catalog.models.find(m=>m.id==='minimax-m2-7')!;assert.equal(updated.rates[0].input,Number((2.1*factor).toPrecision(12)));
  const events=result.history.models.find(m=>m.modelId===updated.id)!.events;assert.equal(events.at(-1)!.verification,'auto_verified');assert.equal(events.at(-2)!.rates[0].input,2.1);
  const rows=getRows(result.catalog,{...defaultFilters,providers:['minimax']}).rows;assert.equal(rows[0].model.id,'minimax-m2-7');assert.equal(rows[0].input,updated.rates[0].input);
});
test('0、超过 60% 波动、降至 20% 以下均不能上线',()=>{
  for(const factor of [0,.19,1.7]){const result=evaluate([candidate('minimax-m2-7',factor)]);assert.equal(result.dataChanged,false);assert.equal(result.catalog.models.find(m=>m.id==='minimax-m2-7')!.rates[0].input,2.1);assert.deepEqual(result.history,baseHistory);assert.ok(result.reviews.length);}
});
test('阈值边界 60% 可自动发布，超过阈值需审核',()=>{
  assert.equal(evaluate([candidate('minimax-m2-7',1.6)]).dataChanged,true);assert.equal(evaluate([candidate('minimax-m2-7',1.6001)]).dataChanged,false);
});
test('缓存列冒充标准输入被阻断且不能通过确认 ID 放行',()=>{
  const item=candidate();item.evidence.inputLabel='cached input';assert.equal(normalizedPriceSchema.safeParse(item).success,false);
  const result=evaluate([item]);assert.equal(result.dataChanged,false);assert.equal(result.reviews[0].status,'blocked');
  assert.throws(()=>evaluate([item],{approvals:[result.reviews[0].id]}),/不可通过 ID/);
});
test('403/500 和结构失败保留旧数据、成功时间；其他厂商可更新',()=>{
  const first=evaluate([candidate()]);
  const good=candidate('deepseek-flash',.8),other=candidate('deepseek-v4-pro');
  const result=evaluateUpdates({catalog,history:baseHistory,verification:first.verification,runs:[run([],{error:'HTTP 403'}),run([good,other])],now});
  assert.equal(result.verification.models['minimax-m2-7'].status,'stale');assert.equal(result.verification.models['minimax-m2-7'].lastSuccessAt,now);assert.equal(result.applied[0].modelId,'deepseek-flash');assert.equal(result.catalog.models.find(m=>m.id==='minimax-m2-7')!.rates[0].input,2.1);
});
test('超过一半模型异常时阻止整家厂商的新值，其他厂商不受影响',()=>{
  const items=[candidate('qwen-flash',.1),candidate('qwen3-7-flash',.1),candidate('qwen3-8-flash',.1),candidate('qwen3-max',.1),candidate('qwen3-8-max',.8),candidate('qwen-flash-singapore')];
  const result=evaluate(items);assert.equal(result.dataChanged,false);assert.ok(result.reviews.every(r=>r.reasons.includes('厂商异常比例超限')));
});
test('模型字段消失不当作下架，不删除当前价或历史',()=>{
  const result=evaluateUpdates({catalog,history:baseHistory,verification:baseVerification,runs:[run([candidate()],{parsed:{items:[candidate()],issues:[{modelId:'minimax-m2-7-highspeed',reason:'输入字段缺失'}],discoveries:[]}})],now});
  assert.equal(result.dataChanged,false);assert.equal(result.catalog.models.length,catalog.models.length);assert.deepEqual(result.history,baseHistory);assert.equal(result.verification.models['minimax-m2-7-highspeed'].status,'stale');
});
test('新模型进入待补齐流程，不自动生成臆测规格',()=>{
  const item=candidate();item.modelId='minimax-new-model';item.apiId='MiniMax-New';item.evidence.modelLabel='MiniMax-New';
  const result=evaluate([item]);assert.ok(result.reviews.some(r=>r.changes.some(c=>c.type==='new_model')));assert.equal(result.catalog.models.length,catalog.models.length);
});
test('明确下架需人工确认，保留永久模型及全部历史',()=>{
  const item=candidate();item.status='retired';const result=evaluate([item]);assert.equal(result.dataChanged,false);
  const approved=evaluate([item],{approvals:[result.reviews.find(r=>r.modelId===item.modelId)!.id]});
  assert.equal(approved.catalog.models.find(m=>m.id===item.modelId)!.status,'retired');assert.deepEqual(approved.history,baseHistory);assert.ok(!getRows(approved.catalog,defaultFilters).rows.some(r=>r.model.id===item.modelId));
});
test('汇率、时间戳、文案和排列变化不产生调价历史或价格提交',()=>{
  const next=structuredClone(catalog);next.meta.usdToCny=7.5;
  const items=[candidate(),candidate('minimax-m2-7-highspeed')].reverse();items[0].evidence.pageSha256='b'.repeat(64);
  const result=evaluate(items,{catalog:next,now:'2026-09-13T12:00:00.000Z'});assert.equal(result.dataChanged,false);assert.deepEqual(result.history,baseHistory);
});
test('精确人工确认可发布异常，旧值或候选变化后 ID 失效',()=>{
  const item=candidate('minimax-m2-7',.25),review=evaluate([item]).reviews[0];
  const result=evaluate([item],{approvals:[review.id]});assert.equal(result.dataChanged,true);assert.equal(result.applied[0].verification,'manual_verified');assert.equal(result.history.models.find(m=>m.modelId===item.modelId)!.events.at(-1)!.verification,'manual_verified');
  assert.throws(()=>evaluate([candidate('minimax-m2-7',.3)],{approvals:[review.id]}),/确认 ID/);
  const zero=candidate('minimax-m2-7',0),blocked=evaluate([zero]).reviews[0];assert.throws(()=>evaluate([zero],{approvals:[blocked.id]}),/确认 ID/);
});
test('同一变化重复运行幂等，不重复追加历史或空提交',()=>{
  const items=[candidate('minimax-m2-7',.8),candidate('minimax-m2-7-highspeed')];const first=evaluate(items);
  const second=evaluateUpdates({...first,runs:[run(items)],now:'2026-09-12T18:00:00.000Z'});assert.equal(second.dataChanged,false);assert.deepEqual(second.history,first.history);
});
test('Diff 区分缓存、阶梯、促销、时段、名称、版本与来源变化',()=>{
  const old=model(),item=candidate();item.rates[0].cacheRead=.5;item.rates[0].upToInputTokens=300000;item.rates[0].offPeakFactor=.5;item.rates[0].promotion={factor:.5,startsAt:'2026-09-12',endsAt:'2026-09-20',note:'测试'};item.name='MiniMax renamed';item.apiId='new-api-id';item.sourceUrl='https://platform.minimax.cn/docs/new-pricing';
  const types=diffPrice(old,item,catalog.sources.find(s=>s.id===old.sourceId)!.url).map(c=>c.type);
  for(const expected of ['cache_price_change','context_tiers_change','promotion_change','time_price_change','model_name_change','model_version_change','source_url_change'])assert.ok(types.includes(expected),expected);
});
test('unknown 默认不排名，stale 继续使用上一次价格',()=>{
  const data=structuredClone(catalog);data.models=data.models.slice(0,2);data.models[0].verification={...baseVerification.models[data.models[0].id],status:'unknown'};data.models[1].verification={...baseVerification.models[data.models[1].id],status:'stale'};
  assert.deepEqual(getRows(data,defaultFilters).rows.map(r=>r.model.id),[data.models[1].id]);
});
test('构建失败恢复全部原文件，成功才保留候选',async()=>{
  const root=await mkdtemp(join(tmpdir(),'pricing-transaction-'));
  try{await writeFile(join(root,'catalog.json'),'old-price');await writeFile(join(root,'history.json'),'old-history');await assert.rejects(()=>stageAndValidate(root,{'catalog.json':'candidate','history.json':'new-history'},async()=>{throw new Error('Astro build failed');}),/build failed/);assert.equal(await readFile(join(root,'catalog.json'),'utf8'),'old-price');assert.equal(await readFile(join(root,'history.json'),'utf8'),'old-history');await stageAndValidate(root,{'catalog.json':'valid'},async()=>{});assert.equal(await readFile(join(root,'catalog.json'),'utf8'),'valid');}finally{await rm(root,{recursive:true,force:true});}
});
test('并发运行拒绝第二个写入者，失败后释放锁',async()=>{
  const root=await mkdtemp(join(tmpdir(),'pricing-lock-'));
  try{await withLock(root,async()=>{await assert.rejects(()=>withLock(root,async()=>{}),/并发/);});await assert.rejects(()=>withLock(root,async()=>{throw new Error('fail');}));await withLock(root,async()=>{});}finally{await rm(root,{recursive:true,force:true});}
});

test('只恢复匹配当前价格且更近的核验状态，失败构建的候选状态不能冒充现价核验',async()=>{
  const {selectVerifiedState}=await import('../scripts/pricing/io');
  const unchanged=evaluate([candidate()]);
  assert.equal(selectVerifiedState(catalog,baseVerification,unchanged.verification),unchanged.verification);
  const changed=evaluate([candidate('minimax-m2-7',.8)]);
  assert.equal(selectVerifiedState(catalog,baseVerification,changed.verification),baseVerification);
  assert.equal(selectVerifiedState(changed.catalog,baseVerification,changed.verification),changed.verification);
});

test('公告中的未来生效价格不得提前发布，也不能用确认 ID 绕过生效时间',()=>{
  const item=candidate('minimax-m2-7',.8);item.effectiveAt='2026-09-13T00:00:00.000Z';
  const result=evaluate([item]);assert.equal(result.dataChanged,false);assert.equal(result.reviews[0].status,'blocked');
  assert.throws(()=>evaluate([item],{approvals:[result.reviews[0].id]}),/确认 ID/);
});
