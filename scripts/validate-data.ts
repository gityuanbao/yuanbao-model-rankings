import { loadData } from './pricing/io';
import { stable, officialPrice } from './pricing/diff';
const {catalog,history,verification}=await loadData();
const today=new Date().toISOString().slice(0,10);
if(catalog.meta.updatedAt>today||catalog.models.some(model=>model.verifiedAt>today))throw new Error('禁止使用未来核验日期');
for(const model of catalog.models){
  const entry=history.models.find(m=>m.modelId===model.id);
  if(!entry||stable(officialPrice(entry.events.at(-1)!))!==stable(officialPrice(model)))throw new Error(`${model.id} 当前价格与最后历史事件不一致；手动调价需运行 prices:record-manual`);
  if(!verification.models[model.id])throw new Error(`${model.id} 缺少核验状态`);
  const source=catalog.sources.find(s=>s.id===model.sourceId)!;
  if(source.retrieval==='search-index'&&verification.models[model.id].status!=='unknown')throw new Error('搜索索引不能进入 v2.1 生产默认排名');
}
for(const previous of history.models)if(!catalog.models.some(m=>m.id===previous.modelId))throw new Error(`${previous.modelId} 历史模型不可删除，请使用 retired 保留永久 URL`);
console.log(`数据与历史校验通过：${catalog.providers.length} 家白名单厂商、${catalog.models.length} 条费率、${history.models.reduce((s,m)=>s+m.events.length,0)} 个历史事件。`);
