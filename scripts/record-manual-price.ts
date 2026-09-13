import { isOfficialUrl, catalogSchema } from '../src/lib/schema';
import { historySchema, verificationFileSchema } from '../src/lib/pricing-metadata';
import { loadData, withLock, stageAndValidate, diskCatalog, json } from './pricing/io';
import { hash, officialPrice, stable, meaningfulCatalog } from './pricing/diff';
const option=(name:string)=>process.argv.find(a=>a.startsWith(`--${name}=`))?.slice(name.length+3);
const id=option('model'), url=option('source'), reason=option('reason');
if(!id||!url||!reason?.trim())throw new Error('先人工编辑 catalog.json，再运行 prices:record-manual -- --model=ID --source=官方URL --reason=核验说明');
await withLock(process.cwd(),async()=>{
  const {catalog,history,verification}=await loadData(); const model=catalog.models.find(m=>m.id===id);
  if(!model)throw new Error('模型未在 catalog.json 中；新模型请先补齐元数据');
  if(!isOfficialUrl(url,model.providerId))throw new Error('必须提供本厂商官方 HTTPS 来源');
  const now=new Date().toISOString();let source=catalog.sources.find(s=>s.id===model.sourceId)!;
  if(catalog.models.filter(m=>m.sourceId===source.id).length>1){source={...source,id:`${model.id}-manual-pricing`};model.sourceId=source.id;catalog.sources.push(source);}
  source.url=url;source.retrieval='page';source.notes=`人工核验：${reason}`;
  let entry=history.models.find(m=>m.modelId===id);
  const previous=entry?.events.at(-1);
  if(!entry){entry={modelId:id,providerId:model.providerId,events:[]};history.models.push(entry);}
  const priceChanged=!!previous&&stable(officialPrice(previous))!==stable(officialPrice(model));
  const sourceChanged=!!previous&&previous.sourceUrl!==url;
  if(!previous||priceChanged||sourceChanged){entry.events.push({id:hash([id,officialPrice(model),url,now]).slice(0,24),detectedAt:now,effectiveAt:null,currency:model.currency,rates:model.rates,sourceUrl:url,reason:previous?'price_change':'initial_snapshot',verification:'manual_verified',changeTypes:previous?[...(priceChanged?['manual_price_change']:[]),...(sourceChanged?['source_change']:[])]:[]});}
  historySchema.parse(history);
  verification.models[id]={status:model.status==='retired'?'deprecated':'fresh',lastCheckedAt:now,lastSuccessAt:now,verification:'manual_verified',reason};
  verification.checkedAt=now;model.verifiedAt=now.slice(0,10);catalog.meta.updatedAt=model.verifiedAt;verification.catalogHash=hash(meaningfulCatalog(catalog));
  catalogSchema.parse(catalog);verificationFileSchema.parse(verification);
  await stageAndValidate(process.cwd(),{'src/data/catalog.json':json(diskCatalog(catalog)),'src/data/price-history.json':json(history),'src/data/verification.json':json(verification)},async()=>{});
  console.log('人工核验与价格历史已记录。请运行 npm test && npm run build，再提交审核。');
});
