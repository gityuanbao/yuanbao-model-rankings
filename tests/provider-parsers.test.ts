import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { adapters } from '../scripts/providers';
import { amount, fetchOfficial } from '../scripts/providers/shared';
import { normalizedPriceSchema, type ProviderId, type RawPricingSnapshot } from '../scripts/pricing/types';
import { fixtureCatalog as catalog } from './fixtures/catalog';
import additions from '../data/pricing/reviewed-provider-additions-2026-09-12.json';
import corrections from '../data/pricing/reviewed-provider-corrections-2026-09-12.json';
import { modelSchema } from '../src/lib/schema';
const recovered: Record<string, string> = { moonshot: 'md', zhipu: 'md', bytedance: 'json' };
const raw = async (id:ProviderId):Promise<RawPricingSnapshot> => {
  const a=adapters.find(a=>a.providerId===id)!;const body=await readFile(`tests/fixtures/providers/${id}.${recovered[id] ?? 'html'}`,'utf8');
  return {providerId:id,url:a.sourceUrl,body,fetchedAt:'2026-09-12T12:00:00.000Z',sha256:createHash('sha256').update(body).digest('hex')};
};
for(const adapter of adapters){
  test(`${adapter.providerId} 独立 Adapter 与 Fixture 契约`,async()=>{
    const snapshot=await raw(adapter.providerId);const models=(recovered[adapter.providerId] ? [...additions.models,...corrections.models].map(entry=>modelSchema.parse(entry.model)) : catalog.models).filter(m=>m.providerId===adapter.providerId);
    if(adapter.mode==='manual'){assert.throws(()=>adapter.parse(snapshot,models));assert.ok(adapter.reason);return;}
    const parsed=adapter.parse(snapshot,models);const manualFree=adapter.providerId==='zhipu'?1:0;
    assert.equal(parsed.issues.length,manualFree);if(manualFree)assert.match(parsed.issues[0].reason,/人工核验/);
    assert.equal(parsed.items.length,models.filter(m=>m.status!=='retired').length-manualFree);assert.equal(adapter.validate(parsed.items).valid,true);
    for(const item of parsed.items){const model=models.find(m=>m.id===item.modelId)!;assert.deepEqual(item.rates,model.rates);}
  });
}
test('网页文字和价格表行排序变化不会改变语义费率',async()=>{
  const a=adapters.find(a=>a.providerId==='minimax')!,snapshot=await raw('minimax');const models=catalog.models.filter(m=>m.providerId==='minimax');
  const original=a.parse(snapshot,models).items;
  const rows=snapshot.body.match(/<tr>[\s\S]*?<\/tr>/g)!;
  snapshot.body='<h1>按量付费标准服务 — 更新说明</h1><table>'+[rows[0],...rows.slice(1).reverse()].join('')+'</table>';
  assert.deepEqual(a.parse(snapshot,models).items.map(i=>i.rates),original.map(i=>i.rates));
});
test('错误把缓存列当标准输入、丢失单位或改成 Batch 时拒绝',async()=>{
  const a=adapters.find(a=>a.providerId==='minimax')!,snapshot=await raw('minimax'),models=catalog.models.filter(m=>m.providerId==='minimax');
  for(const body of [snapshot.body.replaceAll('输入价格','缓存输入价格'),snapshot.body.replaceAll('百万','千'),snapshot.body.replaceAll('输入价格','Batch 输入价格')])assert.throws(()=>a.parse({...snapshot,body},models));
  const candidate=a.parse(snapshot,models).items[0];candidate.evidence.inputLabel='cached input';assert.equal(normalizedPriceSchema.safeParse(candidate).success,false);
});
test('Qwen 地区不可混用、阶梯缺失不可悄悄套用旧值',async()=>{
  const a=adapters.find(a=>a.providerId==='alibaba')!,snapshot=await raw('alibaba'),models=catalog.models.filter(m=>m.providerId==='alibaba');
  assert.throws(()=>a.parse({...snapshot,body:snapshot.body.replace(/华北 2（北京）/g,'国际')},models),/北京/);
});
test('403、500、空页和跨厂商重定向被阻止',async()=>{
  for(const status of [403,500])await assert.rejects(()=>fetchOfficial('deepseek','https://api-docs.deepseek.com/quick_start/pricing/',async()=>new Response('unavailable',{status})),new RegExp(String(status)));
  await assert.rejects(()=>fetchOfficial('deepseek','https://api-docs.deepseek.com/quick_start/pricing/',async()=>new Response('')),/空/);
  await assert.rejects(()=>fetchOfficial('deepseek','https://api-docs.deepseek.com/quick_start/pricing/',async()=>new Response('',{status:302,headers:{location:'https://evil.example/'}})),/非官方/);
});
test('一个价格单元格含多个数字、范围或缺失时不得取第一个数字',()=>{
  for(const value of ['','—','2.1 1.05','0.2–0.4','Free tier','NaN'])assert.throws(()=>amount(value,'CNY'));
  assert.equal(amount('0.0008','CNY',1000),.8);
});
