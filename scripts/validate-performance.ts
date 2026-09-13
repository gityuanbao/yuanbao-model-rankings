import { categorySnapshotsSchema, categoryHistorySchema } from '../src/lib/performance-categories';
import { categorySelection } from './performance/categories';
import assert from 'node:assert/strict';
import { arenaSource, performanceHistorySchema, performanceSnapshotSchema, selectionSchema } from '../src/lib/performance-schema';
import { readJson } from './pricing/io';
import { selectionFor } from './performance/selection';
const data=performanceSnapshotSchema.parse(await readJson('src/data/performance.json'));
const history=performanceHistorySchema.parse(await readJson('data/performance/history.json'));
const selection=selectionSchema.parse(await readJson('data/performance/models.json'));
assert.deepEqual(history.snapshots.at(-1),data,'当前性能榜必须与最新历史快照完全一致');
for(const model of selection.models)assert.ok(data.models.some(m=>m.id===model.id),'已收录模型不可静默丢失');
for(const model of data.models){
  const selected=selectionFor(model.sourceModel,model.providerId,selection);
  assert.ok(selected,'性能榜包含未审核收录的模型');
  for(const key of ['id','name','providerId','sourceModel','mode'] as const)assert.equal(model[key],selected[key],`${model.id} 收录映射不匹配`);
}
history.snapshots.forEach((snapshot,i)=>{
  assert.equal(snapshot.sourceId,arenaSource.id);
  assert.ok(snapshot.publishedAt<=new Date().toISOString().slice(0,10),'禁止未来榜单日期');
  if(i)assert.ok(snapshot.publishedAt>=history.snapshots[i-1].publishedAt,'历史榜单日期不可倒退');
});
console.log(`性能数据校验通过：${data.models.length} 条模型与测试配置，${new Set(data.models.map(m=>m.providerId)).size} 家主流厂商，${history.snapshots.length} 份历史快照。`);

// Category snapshots have independent dates and histories; never compare scores across boards.
const categories=categorySnapshotsSchema.parse(await readJson('src/data/performance-categories.json'));
const categoryHistory=categoryHistorySchema.parse(await readJson('data/performance/categories-history.json'));
const organization:Record<string,string>={openai:'OpenAI',anthropic:'Anthropic',google:'Google',xai:'SpaceXAI',deepseek:'DeepSeek',bytedance:'Bytedance',alibaba:'Alibaba',moonshot:'Moonshot',zhipu:'Z.ai',minimax:'MiniMax',baidu:'Baidu',tencent:'Tencent'};
for(const snapshot of categories.snapshots){
  const history=categoryHistory.snapshots.filter(item=>item.sourceId===snapshot.sourceId);
  assert.deepEqual(history.at(-1),snapshot,'当前分类必须与该分类最新历史快照一致');
  history.forEach((item,index)=>{
    assert.ok(item.publishedAt<=new Date().toISOString().slice(0,10),'禁止未来分类日期');
    if(index)assert.ok(item.publishedAt>=history[index-1].publishedAt,'分类历史日期不可倒退');
  });
  for(const model of snapshot.models){
    const selected=categorySelection(`${model.sourceModel} ${organization[model.providerId]} ·`,selection);
    assert.ok(selected,'分类包含未审核的厂商或系列');
    for(const key of ['id','name','providerId','sourceModel','mode'] as const)assert.equal(model[key],selected[key],`${model.id} 分类映射不匹配`);
  }
  console.log(`${snapshot.sourceId} 校验通过：${snapshot.models.length} 条，${history.length} 份历史，来源日期 ${snapshot.publishedAt}。`);
}
