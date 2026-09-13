import { mkdir, appendFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { adapters } from './providers';
import { evaluateUpdates } from './pricing/pipeline';
import { normalizedPriceSchema, type ProviderRun } from './pricing/types';
import { loadData, withLock, stageAndValidate, diskCatalog, json, readJson, selectVerifiedState } from './pricing/io';
import { verificationFileSchema } from '../src/lib/pricing-metadata';
import { publicReport, markdownReport } from './pricing/report';

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
    const checkedAt=new Date().toISOString();
    try{
      const raw=await adapter.fetch();
      const parsed=adapter.parse(raw,current.catalog.models.filter(m=>m.providerId===adapter.providerId));
      // Invalid rows are isolated; they must never disappear silently or poison other providers.
      parsed.items=parsed.items.filter(item=>{const valid=normalizedPriceSchema.safeParse(item);if(valid.success)return true;parsed.issues.push({modelId:item.modelId,reason:valid.error.issues.map(i=>i.message).join('；')});return false;});
      const valid=adapter.validate(parsed.items);if(!valid.valid)throw new Error(valid.errors.join('；'));
      if(!parsed.items.length&&!parsed.discoveries.length)throw new Error(parsed.issues.map(i=>i.reason).join('；')||'未解析到标准输入/输出价格');
      console.log(`${adapter.providerId}: parsed ${parsed.items.length}, missing ${parsed.issues.length}`);
      return {providerId:adapter.providerId,mode:adapter.mode,checkedAt,parsed};
    }catch(error){const message=error instanceof Error?error.message:String(error);console.log(`${adapter.providerId}: 保留旧价 — ${message}`);return {providerId:adapter.providerId,mode:adapter.mode,checkedAt,error:message};}
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
  const reviewCount=result.reviews.filter(r=>!r.approved).length;
  const output=`changed=${result.dataChanged}\nreview_count=${reviewCount}\nfailed_count=${runs.filter(r=>r.error).length}\n`;
  if(process.env.GITHUB_OUTPUT)await appendFile(process.env.GITHUB_OUTPUT,output);
  if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,markdownReport(result,now));
  console.log(`${apply?'候选已通过测试及生产构建':'仅检查，未写入生产数据'}：价格数据变化 ${result.dataChanged}，待处理 ${reviewCount}；无价格变化时禁止创建价格提交。`);
});
