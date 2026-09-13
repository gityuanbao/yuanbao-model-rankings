import { z } from 'zod';
import { arenaSource, performanceModelSchema, performanceSnapshotSchema, selectionModelSchema, type PerformanceSnapshot } from './performance-schema';

export const performanceCategoryIds = ['text', 'code', 'vision', 'agent'] as const;
export type PerformanceCategory = typeof performanceCategoryIds[number];
export const performanceCategories = {
  text: { label:'综合文本', sourceId:arenaSource.id, url:arenaSource.leaderboardUrl, description:'日常问答、写作与文本推理', method:'Arena 文本用户偏好榜，通过匿名对战投票计算 Bradley–Terry 得分；公开数据集使用风格控制 overall 口径。' },
  code: { label:'网页编程', sourceId:'arena-code', url:'https://arena.ai/leaderboard/code', description:'网页开发与编程交付', method:'Arena WebDev 的 Overall 榜，比较网页开发成果，包含多步推理与工具调用流程。它反映网页开发表现，不能代表所有编程任务。' },
  vision: { label:'视觉理解', sourceId:'arena-vision', url:'https://arena.ai/leaderboard/vision', description:'看图、识图与视觉推理', method:'Arena Vision 的 Overall 榜，比较模型理解图像和视觉推理的表现。这里评估的是看图能力，不是图片生成能力。' },
  agent: { label:'智能体', sourceId:'arena-agent', url:'https://arena.ai/leaderboard/agent', description:'工具调用与真实任务完成', method:'Agent Arena 的 Overall 榜采用因果评估，综合任务确认、用户反馈、纠错、命令恢复及工具幻觉等信号。百分比表示相对基准的估计效应，不是模型完成所有任务的成功率。本站保留官方综合顺序，不按单一信号重新计算总分。' },
} as const;
export const categoryForSource = (sourceId:string):PerformanceCategory => performanceCategoryIds.find(key=>performanceCategories[key].sourceId===sourceId) ?? 'text';
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>!Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0,10)===v);
const common={schemaVersion:z.literal(1),publishedAt:date,retrievedAt:z.string().datetime(),retrieval:z.enum(['official-page','reviewed-official-page']),sourceRowCount:z.number().int().positive().max(5000),excludedModels:z.array(z.object({sourceModel:z.string().min(1),sourceRanks:z.array(z.number().int().positive()).min(2),reason:z.string().min(1)})).optional()};
const signal=z.object({value:z.number().finite().min(-100).max(100),uncertainty:z.number().finite().nonnegative().max(100)});
export const agentSignalLabels={netImprovement:'净提升',confirmedSuccess:'确认完成',praiseVsComplaint:'好评与抱怨',steerability:'纠错响应',bashRecovery:'命令恢复',toolHallucination:'工具幻觉'} as const;
export type AgentSignal = keyof typeof agentSignalLabels;
export const agentModelSchema=selectionModelSchema.extend({
  sourceRank:z.number().int().positive(),sessions:z.number().int().positive(),
  signals:z.object({netImprovement:signal,confirmedSuccess:signal,praiseVsComplaint:signal,steerability:signal,bashRecovery:signal,toolHallucination:signal}),
});
export type AgentModel=z.infer<typeof agentModelSchema>;
const scored=z.object({...common,sourceId:z.enum(['arena-code','arena-vision']),sourceUrl:z.enum([performanceCategories.code.url,performanceCategories.vision.url]),models:z.array(performanceModelSchema).min(1)});
const agent=z.object({...common,sourceId:z.literal('arena-agent'),sourceUrl:z.literal(performanceCategories.agent.url),models:z.array(agentModelSchema).min(1)});
export const categorySnapshotSchema=z.union([scored,agent]).superRefine((data,ctx)=>{
  const category=categoryForSource(data.sourceId);
  if(data.sourceUrl!==performanceCategories[category].url)ctx.addIssue({code:'custom',message:'分类与官方来源不匹配'});
  if(data.publishedAt>data.retrievedAt.slice(0,10))ctx.addIssue({code:'custom',message:'榜单日期不能晚于抓取日期'});
  if(data.models.length>data.sourceRowCount)ctx.addIssue({code:'custom',message:'收录数量大于来源数量'});
  for(const key of ['id','sourceModel','sourceRank'] as const)if(new Set(data.models.map(m=>m[key])).size!==data.models.length)ctx.addIssue({code:'custom',message:`分类榜 ${key} 重复`});
  if(data.models.some(m=>m.sourceRank>data.sourceRowCount))ctx.addIssue({code:'custom',message:'原榜名次超出来源总数'});
  if(data.sourceId!=='arena-agent' && data.models.some(m=>m.scorePrecision!=='rounded'))ctx.addIssue({code:'custom',message:'分类官网榜必须保留原始整数分及区间'});
});
export type CategorySnapshot=z.infer<typeof categorySnapshotSchema>;
export type PerformanceBoardSnapshot=PerformanceSnapshot|CategorySnapshot;
export const performanceBoardSchema=z.union([performanceSnapshotSchema,categorySnapshotSchema]);
export const categorySnapshotsSchema=z.object({schemaVersion:z.literal(1),snapshots:z.array(categorySnapshotSchema).length(3)}).superRefine((data,ctx)=>{
  if(new Set(data.snapshots.map(s=>s.sourceId)).size!==3)ctx.addIssue({code:'custom',message:'分类快照必须包含三个独立分类'});
});
export const categoryHistorySchema=z.object({schemaVersion:z.literal(1),snapshots:z.array(categorySnapshotSchema).min(3)});
