import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { parse } from 'yaml';
import { fixtureCatalog as catalog, fixtureHistory as history, fixtureVerification as verification } from './fixtures/catalog';
import { runProvider } from '../scripts/pricing/run-provider';
import { evaluateUpdates } from '../scripts/pricing/pipeline';
import { markdownReport, publicReport, summarizePriceRun } from '../scripts/pricing/report';
import type { ProviderAdapter, RawPricingSnapshot } from '../scripts/pricing/types';
import deepseek from '../scripts/providers/deepseek';
import minimax from '../scripts/providers/minimax';
import glm from '../scripts/providers/glm';
import { modelSchema } from '../src/lib/schema';
import additions from '../data/pricing/reviewed-provider-additions-2026-09-12.json';
import corrections from '../data/pricing/reviewed-provider-corrections-2026-09-12.json';

const checkedAt='2026-09-14T00:00:00.000Z';
const evaluate=(runs:Awaited<ReturnType<typeof runProvider>>[])=>evaluateUpdates({catalog,history,verification,runs,now:checkedAt});
const adapter:ProviderAdapter={
  providerId:'openai',mode:'manual',reason:'尚未建立可靠的官方解析器',sourceUrl:'https://developers.openai.com/api/docs/pricing',
  fetch:async()=>{throw new Error('不应抓取');},parse:()=>{throw new Error('不应解析');},validate:()=>{throw new Error('不应校验');},
};
const deepseekModels=catalog.models.filter(model=>model.providerId==='deepseek');
const deepseekBody=readFileSync('tests/fixtures/providers/deepseek.html','utf8');
const snapshot=(provider:ProviderAdapter,body:string):RawPricingSnapshot=>({providerId:provider.providerId,url:provider.sourceUrl,fetchedAt:checkedAt,body,sha256:'a'.repeat(64)});
const runDeepseek=(body=deepseekBody,parse=deepseek.parse)=>runProvider({...deepseek,fetch:async()=>snapshot(deepseek,body),parse},deepseekModels,checkedAt);
function alertStatus(failedCount:number){
  const workflow=parse(readFileSync('.github/workflows/update-prices.yml','utf8'));
  return spawnSync('bash',['-c',workflow.jobs.attention.steps[0].run],{encoding:'utf8',env:{...process.env,FAILED_COUNT:String(failedCount)}});
}

test('人工 Adapter 不运行抓取或解析，也不算失败或刷新核验日期',async()=>{
  const run=await runProvider(adapter,catalog.models,checkedAt);
  assert.equal(run.error,undefined);assert.equal(run.manualReason,adapter.reason);
  const result=evaluate([run]);
  assert.equal(result.dataChanged,false);assert.deepEqual(result.history,history);
  assert.deepEqual(result.verification.models,verification.models);
  assert.deepEqual(result.verification.providers,verification.providers);
  assert.deepEqual(summarizePriceRun(result),{manualCount:1,failedCount:0,reviewCount:0});
  assert.match(markdownReport(result,checkedAt),/人工维护，本轮未抓取/);
});

test('自动 Adapter 的 HTTP/解析故障仍然计入失败，并保留旧数据',async()=>{
  for(const message of ['HTTP 503','官网标准价表结构改变']){
    const failing={...adapter,mode:'automatic' as const,fetch:async()=>{throw new Error(message);}};
    const run=await runProvider(failing,catalog.models,checkedAt);
    const result=evaluate([run]);
    assert.equal(run.error,message);assert.equal(summarizePriceRun(result).failedCount,1);
    assert.equal(result.dataChanged,false);assert.deepEqual(result.history,history);
    for(const model of catalog.models.filter(model=>model.providerId==='openai'&&model.status!=='retired')){
      assert.deepEqual(result.catalog.models.find(item=>item.id===model.id)?.rates,model.rates);
      assert.equal(result.verification.models[model.id].lastSuccessAt,verification.models[model.id].lastSuccessAt);
      assert.equal(result.verification.models[model.id].status,'stale');
    }
  }
});

test('没有任何标准价格或新型号的自动解析结果仍是故障',async()=>{
  const run=await runProvider({...adapter,mode:'automatic',fetch:async()=>({providerId:'openai',url:adapter.sourceUrl,fetchedAt:checkedAt,body:'empty',sha256:'a'.repeat(64)}),parse:()=>({items:[],issues:[],discoveries:[]}),validate:()=>({valid:true,errors:[]})},[],checkedAt);
  assert.match(run.error??'',/未解析到标准/);
  assert.equal(summarizePriceRun(evaluate([run])).failedCount,1);
});

test('现有价格解析正常时，新型号待补资料只记审核',async()=>{
  const run=await runDeepseek(deepseekBody,(raw,models)=>({...deepseek.parse(raw,models),discoveries:[{apiId:'deepseek-new',sourceUrl:deepseek.sourceUrl,label:'deepseek-new'}]}));
  const result=evaluate([run]);const summary=summarizePriceRun(result);
  assert.equal(summary.failedCount,0);assert.ok(summary.reviewCount>0);
  assert.equal(result.dataChanged,false);assert.deepEqual(result.history,history);
  assert.equal(publicReport(result,checkedAt).failedCount,0);
  assert.ok(result.reviews.every(review=>review.status==='manual_review'));
  assert.equal(alertStatus(summary.failedCount).status,0);
});

test('传入完整目录时只解析和检查对应厂商，其他厂商不被误报缺失',async()=>{
  const run=await runProvider({...deepseek,fetch:async()=>snapshot(deepseek,deepseekBody)},catalog.models,checkedAt);
  assert.equal(run.error,undefined);assert.equal(run.parsed?.items.length,deepseekModels.length);
  assert.deepEqual(run.parsed?.issues,[]);assert.equal(summarizePriceRun(evaluate([run])).failedCount,0);
});

test('DeepSeek 实际解析器单行坏价仍触发失败告警，其他有效行可继续调价并追加历史',async()=>{
  for(const changeHealthy of [false,true]){
    let body=deepseekBody.replace('<td>$0.3</td>','<td>NOT_A_PRICE</td>');
    if(changeHealthy)body=body.replace('<td>$1.32</td>','<td>$1.056</td>').replace('<td>$0.66</td>','<td>$0.528</td>');
    const run=await runDeepseek(body),result=evaluate([run]);
    assert.equal(run.error,undefined);assert.equal(run.parsed?.items.length,1);
    assert.equal(run.parsed?.issues[0].kind,'parse_error');assert.match(run.parsed!.issues[0].reason,/NOT_A_PRICE/);
    assert.equal(summarizePriceRun(result).failedCount,1);
    const alert=alertStatus(summarizePriceRun(result).failedCount);
    assert.equal(alert.status,1);assert.match(alert.stdout,/::error::/);
    assert.deepEqual(result.catalog.models.find(model=>model.id==='deepseek-flash')?.rates,deepseekModels.find(model=>model.id==='deepseek-flash')?.rates);
    assert.deepEqual(result.history.models.find(model=>model.modelId==='deepseek-flash'),history.models.find(model=>model.modelId==='deepseek-flash'));
    assert.equal(result.dataChanged,changeHealthy);
    if(changeHealthy){
      assert.equal(result.applied.length,1);
      const id=result.applied[0].modelId,oldEvents=history.models.find(model=>model.modelId===id)!.events;
      const events=result.history.models.find(model=>model.modelId===id)!.events;
      assert.deepEqual(events.slice(0,-1),oldEvents);assert.equal(events.length,oldEvents.length+1);
    }else assert.deepEqual(result.history,history);
  }
});

test('Schema 拒绝的单行与未分类 issue 都是故障，不能借其他有效行掩盖',async()=>{
  const invalid=await runDeepseek(deepseekBody,(raw,models)=>{
    const parsed=deepseek.parse(raw,models);parsed.items[0].evidence.inputLabel='cached input';return parsed;
  });
  assert.equal(invalid.error,undefined);assert.equal(invalid.parsed?.issues[0].kind,'parse_error');
  assert.equal(summarizePriceRun(evaluate([invalid])).failedCount,1);
  const legacy=await runDeepseek(deepseekBody,(raw,models)=>{
    const parsed=deepseek.parse(raw,models),missing=parsed.items.shift()!;
    parsed.issues.push({modelId:missing.modelId,reason:'未声明类别的解析失败'});return parsed;
  });
  assert.equal(legacy.parsed?.issues[0].kind,'parse_error');
  assert.equal(summarizePriceRun(evaluate([legacy])).failedCount,1);
});

test('已收录价格全部缺失时，新型号发现不能掩盖故障；缺失未主动报 issue 也会被识别',async()=>{
  const run=await runDeepseek(deepseekBody,()=>({items:[],issues:[],discoveries:[{apiId:'deepseek-new',sourceUrl:deepseek.sourceUrl,label:'deepseek-new'}]}));
  assert.equal(run.error,undefined);assert.equal(run.parsed?.issues.length,deepseekModels.length);
  assert.ok(run.parsed?.issues.every(issue=>issue.kind==='parse_error'));
  const result=evaluate([run]);assert.equal(summarizePriceRun(result).failedCount,1);
  assert.equal(alertStatus(summarizePriceRun(result).failedCount).status,1);
  assert.equal(result.dataChanged,false);assert.deepEqual(result.history,history);
});

test('只有明确已知的 GLM 免费型号和 MiniMax M3 标记人工维护，意外免费仍是解析故障',async()=>{
  const models=[...additions.models,...corrections.models].map(entry=>modelSchema.parse(entry.model)).filter(model=>model.providerId==='zhipu');
  const body=readFileSync('tests/fixtures/providers/zhipu.md','utf8');
  const glmRun=await runProvider({...glm,fetch:async()=>snapshot(glm,body)},models,checkedAt);
  assert.deepEqual(glmRun.parsed?.issues.map(issue=>[issue.modelId,issue.kind]),[['glm-4-7-flash','manual_required']]);
  assert.equal(summarizePriceRun(evaluate([glmRun])).failedCount,0);
  const paid=models.find(model=>model.apiId==='glm-5.3')!;
  const unexpected=await runProvider({...glm,fetch:async()=>snapshot(glm,body.replace(/(\| GLM-5\.3\s*\|[^\n]*?\|)\s*8\s*\|/,'$1 免费 |'))},[paid],checkedAt);
  assert.equal(unexpected.parsed?.issues[0]?.kind,'parse_error');
  assert.equal(summarizePriceRun(evaluate([unexpected])).failedCount,1);
  const m3={...catalog.models.find(model=>model.providerId==='minimax')!,id:'minimax-m3',apiId:'MiniMax-M3'};
  const m3Run=await runProvider({...minimax,fetch:async()=>snapshot(minimax,readFileSync('tests/fixtures/providers/minimax.html','utf8'))},[m3],checkedAt);
  assert.equal(m3Run.error,undefined);assert.equal(m3Run.parsed?.issues[0]?.kind,'manual_required');
  assert.equal(summarizePriceRun(evaluate([m3Run])).failedCount,0);
});

test('实际告警步骤：待审核给 warning；自动抓取故障给 error 并退出失败',()=>{
  const workflow=parse(readFileSync('.github/workflows/update-prices.yml','utf8'));
  const step=workflow.jobs.attention.steps[0];
  for(const [failed,exit,marker] of [['0',0,'::warning::'],['1',1,'::error::'],['4',1,'::error::']] as const){
    const result=spawnSync('bash',['-c',step.run],{encoding:'utf8',env:{...process.env,FAILED_COUNT:failed}});
    assert.equal(result.status,exit);assert.ok(result.stdout.includes(marker));
  }
});
