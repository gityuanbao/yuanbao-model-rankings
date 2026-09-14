import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { parse } from 'yaml';
import { fixtureCatalog as catalog, fixtureHistory as history, fixtureVerification as verification } from './fixtures/catalog';
import { runProvider } from '../scripts/pricing/run-provider';
import { evaluateUpdates } from '../scripts/pricing/pipeline';
import { markdownReport, publicReport, summarizePriceRun } from '../scripts/pricing/report';
import type { ProviderAdapter, ProviderRun } from '../scripts/pricing/types';

const checkedAt='2026-09-14T00:00:00.000Z';
const evaluate=(runs:ProviderRun[])=>evaluateUpdates({catalog,history,verification,runs,now:checkedAt});
const adapter:ProviderAdapter={
  providerId:'openai',mode:'manual',reason:'尚未建立可靠的官方解析器',sourceUrl:'https://developers.openai.com/api/docs/pricing',
  fetch:async()=>{throw new Error('不应抓取');},parse:()=>{throw new Error('不应解析');},validate:()=>{throw new Error('不应校验');},
};

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

test('新型号待补资料只记审核，仍不发布或清空已有价格',()=>{
  const run:ProviderRun={providerId:'minimax',mode:'automatic',checkedAt,parsed:{items:[],issues:[],discoveries:[{apiId:'MiniMax-New',sourceUrl:'https://platform.minimax.io/docs/pricing/pay-as-you-go',label:'MiniMax-New'}]}};
  const result=evaluate([run]);const summary=summarizePriceRun(result);
  assert.equal(summary.failedCount,0);assert.ok(summary.reviewCount>0);
  assert.equal(result.dataChanged,false);assert.deepEqual(result.history,history);
  assert.equal(publicReport(result,checkedAt).failedCount,0);
  assert.ok(result.reviews.some(review=>review.status==='blocked'));
});

test('实际告警步骤：待审核给 warning；自动抓取故障给 error 并退出失败',()=>{
  const workflow=parse(readFileSync('.github/workflows/update-prices.yml','utf8'));
  const step=workflow.jobs.attention.steps[0];
  for(const [failed,exit,marker] of [['0',0,'::warning::'],['1',1,'::error::'],['4',1,'::error::']] as const){
    const result=spawnSync('bash',['-c',step.run],{encoding:'utf8',env:{...process.env,FAILED_COUNT:failed}});
    assert.equal(result.status,exit);assert.ok(result.stdout.includes(marker));
  }
});
