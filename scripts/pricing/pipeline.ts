import { z } from 'zod';
import { catalogSchema, type Catalog, type Model } from '../../src/lib/schema';
import { historySchema, verificationFileSchema, type PriceHistory, type VerificationFile, type Verification } from '../../src/lib/pricing-metadata';
import { normalizedPriceSchema, type ProviderRun, type NormalizedPrice } from './types';
import { diffPrice, hash, meaningfulCatalog, stable, type Change } from './diff';
import { appendHistory } from './history';
import defaultPolicy from './policy.json';
export const policySchema = z.object({maxRelativeChange:z.number().min(0).max(1),minimumRemainingRatio:z.number().min(0).max(1),providerAnomalyFraction:z.number().min(0).max(1),staleAfterDays:z.number().positive()});
export type Policy = z.infer<typeof policySchema>;
export interface Review { id:string; providerId:string; modelId:string; status:'blocked'|'manual_review'; reasons:string[]; sourceUrl:string; changes:Change[]; candidate:NormalizedPrice|null; approved:boolean }
export interface PipelineResult { catalog:Catalog; history:PriceHistory; verification:VerificationFile; reviews:Review[]; applied:{modelId:string;changeId:string;verification:string;changes:Change[]}[]; runs:ProviderRun[]; dataChanged:boolean }
export function assess(old: Model | undefined, item: NormalizedPrice, changes: Change[], policy: Policy): { blocked:boolean; reasons:string[] } {
  const reasons:string[]=[]; let blocked=false;
  const parsed=normalizedPriceSchema.safeParse(item);
  if(!parsed.success){reasons.push(...parsed.error.issues.map(i=>i.message));blocked=true;}
  if(item.rates.some(r=>r.input===0||r.output===0)){reasons.push('标准价为 0，不允许自动或 ID 确认发布；真实免费模型需人工核验 Schema 与免费依据');blocked=true;}
  if(!old)reasons.push('新模型需要维护者补齐地区、规格、状态等元数据后收录');
  for(const change of changes){
    if(change.relativeChange!==null && Math.abs(change.relativeChange)>policy.maxRelativeChange+1e-12)reasons.push(`${change.field} 变动超过 ${policy.maxRelativeChange*100}%`);
    if(typeof change.before==='number'&&change.before>0&&typeof change.after==='number'&&change.after/change.before<policy.minimumRemainingRatio)reasons.push(`${change.field} 降至旧值的 ${policy.minimumRemainingRatio*100}% 以下`);
    if(!['input_up','input_down','output_up','output_down','cache_price_change'].includes(change.type))reasons.push(`${change.type} 涉及计费条件、身份或来源，需人工确认`);
    if(change.type==='cache_price_change'&&(change.before===null||change.after===null||change.after===0))reasons.push('缓存计费新增、消失或归零，需人工确认');
  }
  return {blocked,reasons:[...new Set(reasons)]};
}
const fallback = (): Verification => ({status:'stale',lastCheckedAt:null,lastSuccessAt:null,verification:'unverified',reason:'尚无成功核验记录'});
export function evaluateUpdates(input: {catalog:Catalog;history:PriceHistory;verification:VerificationFile;runs:ProviderRun[];now:string;approvals?:string[];policy?:Policy}): PipelineResult {
  const original=catalogSchema.parse(input.catalog), next=structuredClone(original);
  let history=historySchema.parse(input.history);
  const verification=verificationFileSchema.parse(structuredClone(input.verification)); verification.checkedAt=input.now;
  const policy=policySchema.parse(input.policy??defaultPolicy); const approvals=new Set(input.approvals??[]); const usedApprovals=new Set<string>();
  const reviews:Review[]=[], applied:PipelineResult['applied']=[];
  for(const run of input.runs){
    if(run.mode==='manual')continue;
    const models=original.models.filter(m=>m.providerId===run.providerId&&m.status!=='retired');
    const providerBefore=verification.providers[run.providerId]??fallback();
    if(run.error||!run.parsed){
      verification.providers[run.providerId]={...providerBefore,status:models.length?'stale':'unknown',lastCheckedAt:run.checkedAt,reason:run.error??'未解析到价格'};
      for(const model of models){const before=verification.models[model.id]??fallback();verification.models[model.id]={...before,status:before.status==='unknown'?'unknown':'stale',lastCheckedAt:run.checkedAt,reason:run.error??'解析失败'};}
      continue;
    }
    const candidates=run.parsed.items.map(item=>{
      const old=original.models.find(m=>m.id===item.modelId), source=original.sources.find(s=>s.id===old?.sourceId);
      const changes=diffPrice(old,item,source?.url); const gate=assess(old,item,changes,policy);
      if(item.effectiveAt && Date.parse(item.effectiveAt)>Date.parse(input.now)){gate.blocked=true;gate.reasons.push('官方价格尚未生效，不允许提前上线');}
      if(item.providerId!==run.providerId||old&&old.providerId!==run.providerId){gate.blocked=true;gate.reasons.push('Adapter 与模型厂商身份不一致');}
      const id=hash({modelId:item.modelId,before:old?{...old,verification:undefined,verifiedAt:undefined}:null,source:source?.url,after:{...item,evidence:{...item.evidence,pageSha256:undefined}}}).slice(0,24);
      return {item,old,source,changes,gate,id};
    });
    const seen=new Set<string>();for(const c of candidates){if(seen.has(c.item.modelId))throw new Error(`候选模型重复：${c.item.modelId}`);seen.add(c.item.modelId);}
    const missing=models.filter(m=>!seen.has(m.id));
    const abnormal=new Set([...candidates.filter(c=>c.old&&c.gate.reasons.length).map(c=>c.item.modelId),...missing.map(m=>m.id)]);
    const providerReview=models.length>0 && abnormal.size/models.length>policy.providerAnomalyFraction;
    let successes=0, reviewCount=0;
    for(const c of candidates){
      const {item,old,source,changes,id,gate}=c;
      if(providerReview&&!gate.reasons.includes('厂商异常比例超限'))gate.reasons.push('厂商异常比例超限');
      const approved=approvals.has(id)&&!gate.blocked&&!!old;
      if(approved)usedApprovals.add(id);
      if(gate.reasons.length){reviews.push({id,providerId:run.providerId,modelId:item.modelId,status:gate.blocked?'blocked':'manual_review',reasons:gate.reasons,sourceUrl:item.sourceUrl,changes,candidate:item,approved});}
      if(!old||gate.blocked||gate.reasons.length&&!approved){reviewCount++;if(old){const before=verification.models[old.id]??fallback();verification.models[old.id]={...before,status:before.status==='unknown'?'unknown':'manual_review',lastCheckedAt:run.checkedAt,reason:gate.reasons.join('；')};}continue;}
      const verified=approved?'manual_verified' as const:'auto_verified' as const;
      const model=next.models.find(m=>m.id===old.id)!;
      if(changes.length){
        model.currency=item.currency; model.rates=item.rates; model.apiId=item.apiId; if(item.name)model.name=item.name; if(item.status)model.status=item.status; model.verifiedAt=input.now.slice(0,10);
        if(source?.url!==item.sourceUrl){const id=`${model.id}-auto-pricing`;model.sourceId=id;const existing=next.sources.find(s=>s.id===id);const updated={id,providerId:model.providerId,title:`${model.name} 官方定价`,url:item.sourceUrl,retrieval:'page' as const,notes:'经价格更新流水线核验的官方来源'};if(existing)Object.assign(existing,updated);else next.sources.push(updated);}
        history=appendHistory(history,old,model,item,input.now,verified,changes.map(c=>c.type),source!.url);
        applied.push({modelId:model.id,changeId:id,verification:verified,changes});
      }
      verification.models[old.id]={status:model.status==='retired'?'deprecated':'fresh',lastCheckedAt:run.checkedAt,lastSuccessAt:run.checkedAt,verification:verified,reason:'标准输入、输出和已适配计费条件核验成功'};
      // Direct official parsing may rehabilitate a legacy search-index entry only after review.
      if(source?.retrieval==='search-index'){
        verification.models[old.id].status='unknown';verification.models[old.id].reason='旧索引来源需要人工迁移为官网核验来源';
      }
      successes++;
    }
    for(const model of missing){const before=verification.models[model.id]??fallback();const issue=run.parsed.issues.find(i=>i.modelId===model.id);verification.models[model.id]={...before,status:before.status==='unknown'?'unknown':providerReview?'manual_review':'stale',lastCheckedAt:run.checkedAt,reason:issue?.reason??'标准价格字段消失；不将缺失视为下架'};reviews.push({id:hash([run.providerId,model.id,'missing',issue?.reason]).slice(0,24),providerId:run.providerId,modelId:model.id,status:'blocked',reasons:[issue?.reason??'标准价格字段消失'],sourceUrl:original.sources.find(s=>s.id===model.sourceId)!.url,changes:[],candidate:null,approved:false});}
    for(const discovery of run.parsed.discoveries){reviews.push({id:hash([run.providerId,discovery.apiId,'discovery']).slice(0,24),providerId:run.providerId,modelId:discovery.apiId,status:'manual_review',reasons:['发现未收录模型；人工补齐地区、计费条件、规格和模型元数据后新增，禁止按未知规格自动上线'],sourceUrl:discovery.sourceUrl,changes:[{type:'new_model',field:'model',before:null,after:discovery.label,relativeChange:null}],candidate:null,approved:false});}
    verification.providers[run.providerId]={...providerBefore,status:reviewCount||missing.length?'manual_review':successes?'fresh':'stale',lastCheckedAt:run.checkedAt,lastSuccessAt:successes===models.length&&!reviewCount?run.checkedAt:providerBefore.lastSuccessAt,verification:successes?'auto_verified':providerBefore.verification,reason:`成功 ${successes}；待审核 ${reviewCount}；缺失 ${missing.length}；新模型待收录 ${run.parsed.discoveries.length}`};
  }
  if([...approvals].some(id=>!usedApprovals.has(id)))throw new Error('确认 ID 不匹配当前候选、旧价格已改变，或属于不可通过 ID 放行的变更；未写入任何数据');
  const dataChanged=stable(meaningfulCatalog(original))!==stable(meaningfulCatalog(next));
  if(dataChanged)next.meta.updatedAt=input.now.slice(0,10);
  verification.catalogHash=hash(meaningfulCatalog(next));
  catalogSchema.parse(next);historySchema.parse(history);verificationFileSchema.parse(verification);
  return {catalog:next,history,verification,reviews,applied,runs:input.runs,dataChanged};
}
