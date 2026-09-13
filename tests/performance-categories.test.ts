import test from 'node:test';
import assert from 'node:assert/strict';
import code from '../data/performance/arena-code-2026-09-11.json';
import vision from '../data/performance/arena-vision-2026-08-27.json';
import agent from '../data/performance/arena-agent-2026-09-09.json';
import selectionData from '../data/performance/models.json';
import { catalog } from '../src/lib/catalog';
import { selectionSchema } from '../src/lib/performance-schema';
import { categorySnapshotSchema, categorySnapshotsSchema } from '../src/lib/performance-categories';
import { getPerformanceRows, defaultPerformanceFilters, parsePerformanceFilters, serializePerformanceFilters } from '../src/lib/performance';
import { renderPerformanceLeaders, renderPerformanceMobile, renderPerformanceRows } from '../src/lib/performance-render';
import { normalizeCategory, acceptCategorySnapshot, fetchCategory, parseCategoryHtml } from '../scripts/performance/categories';
const selection=selectionSchema.parse(selectionData);
const now='2026-09-13T00:00:00.000Z';
const snapshots=[code,vision,agent].map(source=>normalizeCategory(source,selection,now));

test('三个官方分类保留独立日期、成绩与原榜名次，只收录现有主流厂商',()=>{
  assert.deepEqual(snapshots.map(s=>s.models.length),[103,110,36]);
  assert.deepEqual(snapshots.map(s=>s.publishedAt),['2026-09-11','2026-08-27','2026-09-09']);
  assert.equal(snapshots[0].models[0].sourceModel,'gpt-6-astra-max');
  assert.equal(snapshots[1].models[0].sourceModel,'claude-fable-5');
  assert.equal(snapshots[2].models[0].sourceModel,'Claude Fable 5.1 (Max)');
  assert.ok(snapshots.every(s=>s.models.every(m=>catalog.providers.some(p=>p.id===m.providerId))));
  const coding=snapshots[0].models[0];assert.ok('score' in coding);
  assert.deepEqual([coding.score,coding.uncertainty,coding.votes,coding.sourceRank],[1800,16,2281,1]);
});
test('Agent 保存真实信号及会话，不伪造文本分数；排名不按单个信号重排',()=>{
  const snapshot=snapshots[2];const first=snapshot.models[0];assert.ok('signals' in first);
  assert.deepEqual(first.signals.confirmedSuccess,{value:22.39,uncertainty:3.04});
  assert.equal(first.sessions,12416);assert.equal('score' in first,false);assert.equal('votes' in first,false);
  const rows=getPerformanceRows(snapshot,catalog,{...defaultPerformanceFilters,category:'agent'});
  assert.ok(rows.every((row,i)=>!i || row.sourceRank>rows[i-1].sourceRank));
  const last=rows.at(-1)!;assert.ok('signals' in last);
  assert.ok(last.signals.netImprovement.value>first.signals.netImprovement.value-1);
  assert.deepEqual(getPerformanceRows(snapshot,catalog,{...defaultPerformanceFilters,category:'agent',order:'asc'}),[...rows].reverse());
  const openai=getPerformanceRows(snapshot,catalog,{...defaultPerformanceFilters,category:'agent',providers:['openai'],query:'astra'});
  assert.equal(openai.length,1);assert.equal(openai[0].rank,2);
});
test('官网同名不同配置无法区分时，两条都暂不收录并保存排除原因',()=>{
  const coding=snapshots[0];
  assert.deepEqual(coding.excludedModels?.[0].sourceRanks,[72,89]);
  assert.ok(!coding.models.some(m=>m.sourceModel==='gpt-5.3-codex (codex-harness)'));
});
test('缺行、乱序、列错位、跨分类源、空分、非对称区间或缺失信号均拒绝',()=>{
  const broken=structuredClone(code);broken.rows[0][3]='1800+16/-17';
  const missing=structuredClone(agent);missing.rows[0][2]='N/A';
  for(const source of [{...code,rows:code.rows.slice(1)},{...code,rows:[...code.rows].reverse()},{...code,sourceUrl:vision.sourceUrl},{...code,headers:agent.headers},broken,missing])assert.throws(()=>normalizeCategory(source,selection,now));
  assert.throws(()=>categorySnapshotSchema.parse({...snapshots[0],sourceUrl:vision.sourceUrl}));
  assert.throws(()=>categorySnapshotsSchema.parse({schemaVersion:1,snapshots:[snapshots[0],snapshots[0],snapshots[2]]}));
});
test('异常变化、日期倒退、模型静默删除和跨分类覆盖被阻止；重复导入无变化',()=>{
  const previous=snapshots[0];
  if(previous.sourceId==='arena-agent')throw new Error('Expected coding snapshot');
  const original=JSON.stringify(previous);
  assert.equal(acceptCategorySnapshot(previous,{...previous,retrievedAt:'2026-09-13T01:00:00.000Z'}),false);
  const changed=structuredClone(previous);const model=changed.models[0];assert.ok('score' in model);model.score+=101;
  assert.throws(()=>acceptCategorySnapshot(previous,changed),/100 分/);
  assert.throws(()=>acceptCategorySnapshot(previous,{...previous,publishedAt:'2026-09-10'}),/倒退/);
  assert.throws(()=>acceptCategorySnapshot(previous,{...previous,models:previous.models.slice(1)}),/删除/);
  assert.throws(()=>acceptCategorySnapshot(previous,snapshots[1]),/跨分类/);
  const agentChanged=structuredClone(snapshots[2]);const agentModel=agentChanged.models[0];assert.ok('signals' in agentModel);agentModel.signals.confirmedSuccess.value+=21;
  assert.throws(()=>acceptCategorySnapshot(snapshots[2],agentChanged),/20 个百分点/);
  assert.equal(JSON.stringify(previous),original);
});
test('分类、厂商、搜索和方向可分享恢复，未知分类回退文本榜',()=>{
  const state=parsePerformanceFilters('?category=agent&providers=openai,google&q=high&order=asc');
  assert.equal(state.category,'agent');assert.deepEqual(parsePerformanceFilters(serializePerformanceFilters(state)),state);
  assert.equal(parsePerformanceFilters('?category=unknown').category,'text');
  assert.equal(serializePerformanceFilters(defaultPerformanceFilters),'');
  assert.equal(getPerformanceRows(snapshots[1],catalog,{...defaultPerformanceFilters,category:'vision',query:'不存在的型号'}).length,0);
});
test('Agent 桌面与移动端展示六项信号与真实会话数，前三卡片保留本地彩色 Logo',()=>{
  const rows=getPerformanceRows(snapshots[2],catalog,{...defaultPerformanceFilters,category:'agent'});
  for(const render of [renderPerformanceRows,renderPerformanceMobile]){
    const html=render(rows.slice(0,1),catalog,'/model-prices/');
    assert.match(html,/12,416/);assert.match(html,/22.39%/);assert.match(html,/工具幻觉/);
    assert.match(html,/arena.ai\/leaderboard\/agent/);assert.doesNotMatch(html,/Arena 得分|对战票数/);
    assert.match(html,/\/model-prices\/logos\/anthropic.svg/);
    assert.doesNotMatch(render([{...rows[0],name:'<script>bad</script>'}],catalog,'/'),/<script>/);
  }
  const leaders=renderPerformanceLeaders(rows,catalog,'/');
  assert.equal((leaders.match(/class="champion-card/g)??[]).length,3);
  assert.match(leaders,/原榜综合名次/);
});

test('Agent 三处主指标均为原榜综合名次，本站名次与辅助净提升分开',()=>{
  const rows=getPerformanceRows(snapshots[2],catalog,{...defaultPerformanceFilters,category:'agent',providers:['minimax']});
  const row=rows[0];assert.equal(row.sourceModel,'Minimax M3');
  assert.deepEqual([row.rank,row.sourceRank],[31,34]);
  const desktop=renderPerformanceRows([row],catalog,'/');
  const mobile=renderPerformanceMobile([row],catalog,'/');
  const leaders=renderPerformanceLeaders(rows,catalog,'/');
  const cells=[...desktop.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(match=>match[1]);
  assert.match(cells[1],/>#34<\/strong>/);assert.doesNotMatch(cells[1],/%/);
  assert.match(cells[3],/5\.38%/);
  assert.match(mobile,/<small>本站<\/small>31/);
  assert.match(mobile,/class="mobile-cost"><strong>#34<\/strong><span>原榜综合名次/);
  assert.match(mobile,/<dt>净提升<\/dt><dd>5\.38%/);
  assert.match(leaders,/本站 #31/);assert.match(leaders,/智能体 · 领先模型/);
  assert.match(leaders,/class="champion-price">#34<span class="price-unit">原榜综合名次/);
  assert.equal(renderPerformanceLeaders([...rows].reverse(),catalog,'/'),leaders);
});

test('Agent 的 Qwen Max 产品名与带括号的 Max 评测配置分别保留',()=>{
  const qwen=snapshots[2].models.find(model=>model.sourceModel==='Qwen3.7 Max')!;
  const astra=snapshots[2].models.find(model=>model.sourceModel==='GPT 6 Astra (Max)')!;
  assert.deepEqual([qwen.name,qwen.mode,qwen.id],['Qwen3.7 Max',undefined,'arena-qwen3-7-max-7f8cac68']);
  assert.deepEqual([astra.name,astra.mode],['GPT-6 Astra','Max']);
});
test('官网 HTML 读取完整表格并保持 UTC 日期，403、缺表、缺记录保留快照',async()=>{
  const source={...vision,sourceRowCount:1,rows:[vision.rows[0]]};
  const html=`<h1>Vision Arena</h1><p>Aug 27, 2026</p><p>1 models</p><table><thead><tr>${source.headers.map(cell=>`<th>${cell}</th>`).join('')}</tr></thead><tbody><tr>${source.rows[0].map(cell=>`<td>${cell}</td>`).join('')}</tr></tbody></table>`;
  assert.deepEqual(parseCategoryHtml(html,'vision'),source);
  const nested=parseCategoryHtml(html.replace('1313±8','<span>1313</span><span>± 8</span>'),'vision');
  const model=normalizeCategory(nested,selection,now).models[0];
  assert.ok('score' in model);assert.equal(model.score,1313);assert.equal(model.uncertainty,8);
  assert.throws(()=>parseCategoryHtml(html.replace('1 models','2 models'),'vision'),/完整/);
  assert.throws(()=>parseCategoryHtml('<html>blocked</html>','agent'),/结构/);
  await assert.rejects(fetchCategory('vision',async()=>new Response('blocked',{status:403})),/403/);
  assert.deepEqual(await fetchCategory('vision',async()=>new Response(html)),source);
});
