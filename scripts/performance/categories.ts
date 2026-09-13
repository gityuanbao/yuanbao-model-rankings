import { parse, type DefaultTreeAdapterMap } from 'parse5';
import { z } from 'zod';
import { categorySnapshotSchema, performanceCategories, agentSignalLabels, type CategorySnapshot, type AgentModel, type AgentSignal } from '../../src/lib/performance-categories';
import type { PerformanceModel, PerformanceSelection } from '../../src/lib/performance-schema';
import { providerFor, selectionFor } from './selection';

const scoredHeaders=['Rank','Rank Spread','Model','Score','Votes','Price $/M','Context'];
const agentHeaders=['Rank','Model','Net Improvement','Confirmed Success','Praise vs Complaint','Steerability','Bash Recovery','Tool Hallucination','Sessions','Cost/Task (P50)','Output Tokens/Task (P50)','Price $/M'];
export const categoryImportSchema=z.object({category:z.enum(['code','vision','agent']),sourceUrl:z.string().url(),publishedAt:z.string(),sourceRowCount:z.number().int().positive().max(5000),headers:z.array(z.string()),rows:z.array(z.array(z.string())).min(1)}).superRefine((data,ctx)=>{
  const headers=data.category==='agent'?agentHeaders:scoredHeaders;
  if(data.sourceUrl!==performanceCategories[data.category].url)ctx.addIssue({code:'custom',message:'必须使用对应分类的官方来源'});
  if(JSON.stringify(data.headers)!==JSON.stringify(headers))ctx.addIssue({code:'custom',message:'官方表格列发生变化，需人工核对'});
  if(data.rows.length!==data.sourceRowCount || data.rows.some((r,i)=>r.length!==headers.length || !new RegExp(`^${i+1}(?: |$)`).test(r[0])))ctx.addIssue({code:'custom',message:'官网记录必须完整且保留全部原榜名次'});
});
export type CategoryImport=z.infer<typeof categoryImportSchema>;
const integer=(value:string)=>{if(!/^\d{1,3}(?:,\d{3})*$|^\d+$/.test(value))throw new Error('票数/会话数格式异常');return Number(value.replaceAll(',',''));};
const orgPattern=/^(.+?)\s+(OpenAI|Anthropic|Google|xAI|SpaceXAI|DeepSeek|Bytedance|ByteDance|Alibaba|Moonshot(?:AI)?|Z\.ai|Zhipu|MiniMax|Baidu|Tencent)\s*·/i;
export function categorySelection(cell:string, selection:PerformanceSelection) {
  const parts=cell.match(orgPattern);if(!parts)return;
  const sourceModel=parts[1].trim();const providerId=providerFor(parts[2]);
  // Agent uses display names with spaces. Preserve its exact source identity separately.
  const normalized=sourceModel.toLowerCase().replace(/\s*\((xhigh|high|medium|low|max)\)/g,'-$1').replace(/\s+/g,'-');
  const selected=selectionFor(normalized,providerId,selection);if(!selected)return;
  return {...selected,sourceModel};
}
export function normalizeCategory(input:unknown, selection:PerformanceSelection, now:string, retrieval:'official-page'|'reviewed-official-page'='reviewed-official-page'):CategorySnapshot {
  const data=categoryImportSchema.parse(input);
  const models:(PerformanceModel|AgentModel)[]=[];
  const modelColumn=data.category==='agent'?1:2;
  const duplicateCells=[...new Set(data.rows.map(row=>row[modelColumn]))].filter(cell=>data.rows.filter(row=>row[modelColumn]===cell).length>1);
  const excludedModels=duplicateCells.map(cell=>({sourceModel:cell,sourceRanks:data.rows.filter(row=>row[modelColumn]===cell).map(row=>Number(row[0].split(' ')[0])),reason:'官网同名记录对应多个名次，无法确认具体配置，暂不收录'}));
  for(const cells of data.rows){
    const sourceRank=Number(cells[0].split(' ')[0]);
    const agent=data.category==='agent';
    const cell=cells[agent?1:2];
    if(duplicateCells.includes(cell))continue;
    // Validate every row, including excluded organizations, to reject partial/broken parsing.
    const votes=integer(cells[agent?8:4]);
    if(agent){
      const signals={} as AgentModel['signals'];
      Object.keys(agentSignalLabels).forEach((key,index)=>{
        const match=cells[index+2].replace(/\s+/g,'').match(/^([+-]?\d+(?:\.\d+)?)%±(\d+(?:\.\d+)?)%$/);
        if(!match)throw new Error('Agent 信号缺失或单位变化');
        signals[key as AgentSignal]={value:Number(match[1]),uncertainty:Number(match[2])};
      });
      const selected=categorySelection(cell,selection);
      if(selected)models.push({...selected,sourceRank,sessions:votes,signals});
    } else {
      const match=cells[3].replace(/\s+/g,'').match(/^(\d+)(?:±(\d+)|\+(\d+)\/-(\d+))(Preliminary)?$/);
      if(!match || (match[3] && match[3]!==match[4]))throw new Error('官网评分格式或非对称区间需人工核对');
      const selected=categorySelection(cell,selection);
      if(selected)models.push({...selected,sourceRank,score:Number(match[1]),scorePrecision:'rounded',uncertainty:Number(match[2]??match[3]),lower:null,upper:null,votes,preliminary:!!match[5]});
    }
  }
  return categorySnapshotSchema.parse({schemaVersion:1,sourceId:performanceCategories[data.category].sourceId,sourceUrl:data.sourceUrl,publishedAt:data.publishedAt,retrievedAt:now,retrieval,sourceRowCount:data.sourceRowCount,models,...(excludedModels.length?{excludedModels}:{})});
}
export function acceptCategorySnapshot(previous:CategorySnapshot|null,candidate:CategorySnapshot){
  categorySnapshotSchema.parse(candidate);
  if(!previous)return true;
  if(previous.sourceId!==candidate.sourceId)throw new Error('禁止跨分类覆盖成绩');
  if(candidate.publishedAt<previous.publishedAt)throw new Error('来源日期倒退');
  for(const model of previous.models){
    const next=candidate.models.find(m=>m.id===model.id);
    if(!next)throw new Error('已收录模型被删除，需人工核对');
    if(next.sourceModel!==model.sourceModel || next.providerId!==model.providerId)throw new Error('模型映射改变，需人工核对');
    if('score' in model && 'score' in next && Math.abs(model.score-next.score)>100)throw new Error('得分变化超过 100 分，需人工核对');
    if('signals' in model && 'signals' in next && Object.keys(agentSignalLabels).some(key=>Math.abs(model.signals[key as AgentSignal].value-next.signals[key as AgentSignal].value)>20))throw new Error('Agent 信号变化超过 20 个百分点，需人工核对');
  }
  return JSON.stringify([previous.publishedAt,previous.models])!==JSON.stringify([candidate.publishedAt,candidate.models]);
}
type Node=DefaultTreeAdapterMap['node'];
const children=(node:Node):Node[]=>'childNodes' in node?node.childNodes:[];
const text=(node:Node):string=>'value' in node?node.value:children(node).map(text).join(' ');
const elements=(node:Node,tag:string):Node[]=>[...('tagName' in node && node.tagName===tag?[node]:[]),...children(node).flatMap(child=>elements(child,tag))];
export function parseCategoryHtml(html:string,category:CategoryImport['category']):CategoryImport {
  const doc=parse(html);const tables=elements(doc,'table');
  const expected=category==='agent'?agentHeaders:scoredHeaders;
  const clean=(node:Node)=>text(node).replace(/\s+/g,' ').trim();
  const matching=tables.filter(table=>JSON.stringify(elements(table,'thead').flatMap(head=>elements(head,'th').map(clean)))===JSON.stringify(expected));
  if(matching.length!==1)throw new Error('官网表格结构不可确认，保留有效分类快照');
  const rows=elements(matching[0],'tbody').flatMap(body=>elements(body,'tr').map(row=>children(row).filter(n=>'tagName' in n && ['td','th'].includes(n.tagName)).map(clean)));
  const content=clean(doc);
  const dates=[...new Set(content.match(/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{1,2}, \d{4}\b/g))];
  const counts=[...new Set([...content.matchAll(/\b([\d,]+) models\b/g)].map(m=>integer(m[1])))];
  if(dates.length!==1 || counts.length!==1)throw new Error('无法确定榜单发布日期或完整记录数');
  return categoryImportSchema.parse({category,sourceUrl:performanceCategories[category].url,publishedAt:new Date(dates[0]+' UTC').toISOString().slice(0,10),sourceRowCount:counts[0],headers:expected,rows});
}
export async function fetchCategory(category:CategoryImport['category'],fetcher:typeof fetch=fetch){
  const response=await fetcher(performanceCategories[category].url,{signal:AbortSignal.timeout(20_000),redirect:'error',headers:{Accept:'text/html'}});
  if(!response.ok)throw new Error(`Arena ${category} HTTP ${response.status}`);
  const html=await response.text();if(html.length>8_000_000)throw new Error('官网响应过大');
  return parseCategoryHtml(html,category);
}
