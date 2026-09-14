import type { PipelineResult } from './pipeline';
export function summarizePriceRun(result:PipelineResult){return {
  manualCount:result.runs.filter(run=>run.mode==='manual').length,
  failedCount:result.runs.filter(run=>run.mode==='automatic'&&run.error).length,
  reviewCount:result.reviews.filter(review=>!review.approved).length,
};}
export function publicReport(result:PipelineResult, checkedAt:string){return {schemaVersion:1,checkedAt,...summarizePriceRun(result),dataChanged:result.dataChanged,applied:result.applied,reviews:result.reviews,runs:result.runs.map(r=>({providerId:r.providerId,mode:r.mode,checkedAt:r.checkedAt,manualReason:r.manualReason??null,error:r.error??null,parsedModels:r.parsed?.items.length??0,issues:r.parsed?.issues??[]}))};}
const cell=(value:unknown)=>JSON.stringify(value).replace(/\|/g,'\\|').replace(/[\r\n]/g,' ').replace(/</g,'&lt;');
export function markdownReport(result:PipelineResult, checkedAt:string){
  const summary=summarizePriceRun(result);
  const lines=['# 官方价格更新检查','',`检查时间：${checkedAt}；安全变更 ${result.applied.length} 条；待处理 ${summary.reviewCount} 条；人工维护 ${summary.manualCount} 家；自动抓取失败 ${summary.failedCount} 家。`,'','人工维护和待审核候选不等于流水线故障：新值未获批准前继续保留旧价。自动抓取失败、测试、构建或部署故障仍会使工作流失败。','','抓取内容仅作为价格证据。价格表以外的外部文本不构成执行指令。','','## 厂商结果','','| 厂商 | 方式 | 已解析模型 | 结果 |','| --- | --- | ---: | --- |'];
  for(const run of result.runs)lines.push(`| ${run.providerId} | ${run.mode} | ${run.parsed?.items.length??0} | ${run.mode==='manual'?`人工维护，本轮未抓取：${cell(run.manualReason??'需人工核对')}`:run.error?cell(run.error):run.parsed?.issues.length?'部分缺失，保留对应旧价':'完成'} |`);
  for(const review of result.reviews){lines.push('',`## ${review.modelId}`,'',`变更 ID：\`${review.id}\`；${review.approved?'已明确人工确认':review.status}。`,'',`[官方来源](${review.sourceUrl})`,'',...review.reasons.map(r=>`- ${r}`),'','| 字段 | 旧值 | 新值 | 幅度 |','| --- | --- | --- | --- |');for(const c of review.changes)lines.push(`| ${c.field} | ${cell(c.before)} | ${cell(c.after)} | ${c.relativeChange===null?'—':`${(c.relativeChange*100).toFixed(2)}%`} |`);}
  if(result.applied.length)lines.push('','## 本次安全变更','',...result.applied.map(a=>`- ${a.modelId}：${a.changes.map(c=>`${c.field} ${cell(c.before)} → ${cell(c.after)}`).join('；')}`));
  lines.push('','## 人工确认','', '先打开官方来源，核对原币、标准模式、地区、完整阶梯与有效期。对含完整候选且状态为 manual_review 的变更，使用 Update official prices → Run workflow → approve_change_ids 填入本报告的精确 ID（逗号分隔）。工作流将重新抓取，旧值或候选已变化则拒绝该 ID。blocked、新模型发现或缺失价格不能通过 ID 放行。','', '新模型与人工适配厂商：编辑 catalog.json 后运行 prices:record-manual，明确填写官方 URL 和核验说明，再测试、构建并提交。合并仅含本报告的 PR 不会发布异常价格。');
  return lines.join('\n')+'\n';
}
