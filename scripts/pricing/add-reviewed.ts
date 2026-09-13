import { z } from 'zod';
import { catalogSchema, modelSchema, isOfficialUrl, type Catalog } from '../../src/lib/schema';
import { historySchema, verificationFileSchema, type PriceHistory, type VerificationFile } from '../../src/lib/pricing-metadata';
import { hash, meaningfulCatalog, officialPrice, stable } from './diff';

export const reviewedAdditionsSchema = z.object({
  schemaVersion: z.literal(1),
  reviewedAt: z.string().datetime(),
  sources: catalogSchema.innerType().shape.sources,
  models: z.array(z.object({model:modelSchema, reason:z.string().min(10)})).min(1),
});

// This explicit maintenance operation only adds reviewed models. Existing price changes
// must continue through the normal Diff/review workflow or record-manual command.
export function addReviewedModels(current:{catalog:Catalog;history:PriceHistory;verification:VerificationFile}, input:unknown, now:string) {
  const reviewed=reviewedAdditionsSchema.parse(input);
  if(Date.parse(reviewed.reviewedAt)>Date.parse(now))throw new Error('核验时间不能在未来');
  const result=structuredClone(current);
  const added:string[]=[];
  if(new Set(reviewed.models.map(r=>r.model.id)).size!==reviewed.models.length)throw new Error('新增清单模型 ID 重复');
  const sourceMap=new Map(result.catalog.sources.map(s=>[s.id,s]));
  for(const source of reviewed.sources){
    if(source.retrieval!=='page'||!isOfficialUrl(source.url,source.providerId))throw new Error('新增价格必须来自完整官方页面，不能使用搜索摘要');
    const previous=sourceMap.get(source.id);
    if(previous&&stable(previous)!==stable(source))throw new Error('新增清单不得覆盖已有来源');
    sourceMap.set(source.id,source);
  }
  for(const {model,reason} of reviewed.models){
    if(model.verifiedAt!==reviewed.reviewedAt.slice(0,10)||model.verification)throw new Error('核验日期不一致或包含未授权状态');
    const source=sourceMap.get(model.sourceId);
    if(!source||source.providerId!==model.providerId||source.retrieval!=='page')throw new Error('模型缺少本厂商完整官方价格来源');
    if(model.rates.some(r=>r.input<=0||r.output<=0))throw new Error('新增价格不得以零值占位');
    const previous=result.catalog.models.find(m=>m.id===model.id);
    if(previous){
      const {verification:_old,...old}=previous;
      if(stable(old)!==stable(model))throw new Error(`${model.id} 已存在；不得绕过价格 Diff 覆盖旧模型`);
      continue;
    }
    if(result.catalog.models.some(m=>m.providerId===model.providerId&&m.apiId===model.apiId&&m.region===model.region))throw new Error('同厂商、API 型号与地区重复');
    if(result.history.models.some(m=>m.modelId===model.id))throw new Error('历史模型不可冒充新增');
    result.catalog.models.push(model);added.push(model.id);
    // The first verified model resolves a provider-wide "no prices yet" notice.
    const provider=result.catalog.providers.find(provider=>provider.id===model.providerId)!;
    if(model.status!=='retired')provider.pendingReason=null;
    if(!result.catalog.sources.some(s=>s.id===source.id))result.catalog.sources.push(source);
    result.history.models.push({modelId:model.id,providerId:model.providerId,events:[{
      id:hash([model.id,officialPrice(model),reviewed.reviewedAt]).slice(0,24),detectedAt:reviewed.reviewedAt,effectiveAt:null,
      currency:model.currency,rates:structuredClone(model.rates),sourceUrl:source.url,reason:'initial_snapshot',verification:'manual_verified',changeTypes:[],
    }]});
    result.verification.models[model.id]={status:'fresh',lastCheckedAt:reviewed.reviewedAt,lastSuccessAt:reviewed.reviewedAt,verification:'manual_verified',reason};
  }
  if(added.length){
    result.catalog.meta.updatedAt=[result.catalog.meta.updatedAt,reviewed.reviewedAt.slice(0,10)].sort().at(-1)!;
    result.verification.checkedAt=[result.verification.checkedAt ?? '',reviewed.reviewedAt].sort().at(-1)!;
    result.verification.catalogHash=hash(meaningfulCatalog(result.catalog));
  }
  catalogSchema.parse(result.catalog);historySchema.parse(result.history);verificationFileSchema.parse(result.verification);
  return {...result,added};
}
