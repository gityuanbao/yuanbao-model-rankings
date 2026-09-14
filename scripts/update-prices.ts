import { mkdir, appendFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { adapters } from './providers';
import { evaluateUpdates } from './pricing/pipeline';
import { type ProviderRun } from './pricing/types';
import { runProvider } from './pricing/run-provider';
import { loadData, withLock, stageAndValidate, diskCatalog, json, readJson, selectVerifiedState } from './pricing/io';
import { verificationFileSchema } from '../src/lib/pricing-metadata';
import { publicReport, markdownReport, summarizePriceRun } from './pricing/report';

const root=process.cwd();
const option=(name:string)=>process.argv.find(a=>a.startsWith(`--${name}=`))?.slice(name.length+3);
const selected=option('provider'); const apply=process.argv.includes('--apply');
const approvals=(option('approve')??'').split(',').filter(Boolean);
if(approvals.some(id=>! /^[a-f0-9]{24}$/.test(id)))throw new Error('变更 ID 必须是报告中的完整 24 位十六进制 ID');
const chosen=selected?adapters.filter(a=>a.providerId===selected):adapters;
if(!chosen.length)throw new Error('未知 Provider ID');
const runCommand=(args:string[])=>new Promise<void>((resolve,reject)=>{const process=spawn('npm',args,{cwd:root,stdio:'inherit',env:{...globalThis.process.env,ASTRO_TELEMETRY_DISABLED:'1'}});process.on('error',reject);process.on('exit',code=>code===0?resolve():reject(new Error(`npm ${args.join(' ')} 失败 (${code})；回滚候选数据`)));});
await withLock(root,async()=>{
  const current=await loadData(root); const prior=option('state');
  if(prior){try{const saved=verificationFileSchema.parse(await readJson(prior));current.verification=selectVerifiedState(current.catalog,current.verification,saved);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw new Error(`上一轮状态文件无效：${String(error)}`);}}
  const runs:ProviderRun[]=[];
  for(let offset=0;offset<chosen.length;offset+=3){runs.push(...await Promise.all(chosen.slice(offset,offset+3).map(async adapter=>{
    const run=await runProvider(adapter,current.catalog.models.filter(model=>model.providerId===adapter.providerId));
    console.log(`${adapter.providerId}: ${run.mode==='manual'?'人工维护，本轮跳过自动抓取':run.error?`抓取失败，保留旧价 — ${run.error}`:`parsed ${run.parsed!.items.length}, missing ${run.parsed!.issues.length}`}`);
    return run;
  })));}
  const now=new Date().toISOString();
  const result=evaluateUpdates({...current,runs,now,approvals});
  await mkdir(join(root,'reports'),{recursive:true});
  const report=publicReport(result,now);
  await writeFile(join(root,'reports/review-report.json'),json(report));
  await writeFile(join(root,'reports/price-review.md'),markdownReport(result,now));
  // Stable review content prevents timestamp-only PR commits on repeated checks.
  await writeFile(join(root,'reports/review-pending.json'),json({schemaVersion:1,reviews:result.reviews.filter(r=>!r.approved).map(({candidate,...review})=>({...review,candidate:candidate?{...candidate,effectiveAt:candidate.effectiveAt,evidence:{...candidate.evidence,pageSha256:undefined}}:null}))}));
  await writeFile(join(root,'reports/verification.json'),json(result.verification));
  if(apply){
    const files:Record<string,string>={'src/data/verification.json':json(result.verification)};
    if(result.dataChanged){files['src/data/catalog.json']=json(diskCatalog(result.catalog));files['src/data/price-history.json']=json(result.history);}
    await stageAndValidate(root,files,async()=>{await runCommand(['run','validate:workflows']);await runCommand(['test']);await runCommand(['run','build']);await runCommand(['run','validate:build']);});
  }
  const {reviewCount,failedCount,manualCount}=summarizePriceRun(result);
  const output=`changed=${result.dataChanged}\nreview_count=${reviewCount}\nfailed_count=${failedCount}\nmanual_count=${manualCount}\n`;
  if(process.env.GITHUB_OUTPUT)await appendFile(process.env.GITHUB_OUTPUT,output);
  if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,markdownReport(result,now));
  console.log(`${apply?'候选已通过测试及生产构建':'仅检查，未写入生产数据'}：价格数据变化 ${result.dataChanged}，待处理 ${reviewCount}；无价格变化时禁止创建价格提交。`);
});
