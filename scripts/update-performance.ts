import { appendFile, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { arenaSource, performanceHistorySchema, performanceSnapshotSchema, selectionSchema } from '../src/lib/performance-schema';
import { categoryHistorySchema, categorySnapshotsSchema, categoryForSource, performanceCategoryIds, type PerformanceCategory } from '../src/lib/performance-categories';
import { acceptSnapshot, fetchArena, normalizeArena, parseArenaImport } from './performance/arena';
import { acceptCategorySnapshot, fetchCategory, normalizeCategory } from './performance/categories';
import { atomicWrite, json, readJson, stageAndValidate, withLock } from './pricing/io';

const apply=process.argv.includes('--apply');
const input=process.argv.find(arg=>arg.startsWith('--from-file='))?.slice('--from-file='.length);
const run=(args:string[])=>new Promise<void>((resolve,reject)=>{
  const child=spawn('npm',args,{stdio:'inherit',env:{...process.env,ASTRO_TELEMETRY_DISABLED:'1'}});
  child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error(`npm ${args.join(' ')} 失败，回滚性能榜候选数据`)));
});
await withLock(process.cwd(),async()=>{
  try {
    const selection=selectionSchema.parse(await readJson('data/performance/models.json'));
    const previous=performanceSnapshotSchema.parse(await readJson('src/data/performance.json'));
    const history=performanceHistorySchema.parse(await readJson('data/performance/history.json'));
    const categories=categorySnapshotsSchema.parse(await readJson('src/data/performance-categories.json'));
    const categoryHistory=categoryHistorySchema.parse(await readJson('data/performance/categories-history.json'));
    const imported=input?JSON.parse(await readFile(input,'utf8')):null;
    const keys:PerformanceCategory[]=imported?[imported.category??'text']:[...performanceCategoryIds];
    if(keys.some(key=>!performanceCategoryIds.includes(key)))throw new Error('未知性能分类');
    const files:Record<string,string>={};
    const results=[];
    for(const category of keys){
      try {
        const now=new Date().toISOString();
        if(category==='text'){
          const source=imported?parseArenaImport(imported):null;
          const raw=source?source.rows:await fetchArena();
          const candidate=normalizeArena(raw,selection,now,source?.retrieval??'official-api',source?.sourceUrl??arenaSource.url);
          const changed=acceptSnapshot(previous,candidate);
          if(changed){history.snapshots.push(candidate);files['src/data/performance.json']=json(candidate);files['data/performance/history.json']=json(history);}
          results.push({category,status:changed?'candidate':'unchanged',changed,publishedAt:candidate.publishedAt,models:candidate.models.length,retrieval:candidate.retrieval});
        } else {
          const source=imported??await fetchCategory(category);
          const candidate=normalizeCategory(source,selection,now,imported?'reviewed-official-page':'official-page');
          const index=categories.snapshots.findIndex(s=>categoryForSource(s.sourceId)===category);
          const changed=acceptCategorySnapshot(categories.snapshots[index],candidate);
          if(changed){categories.snapshots[index]=candidate;categoryHistory.snapshots.push(candidate);files['src/data/performance-categories.json']=json(categories);files['data/performance/categories-history.json']=json(categoryHistory);}
          results.push({category,status:changed?'candidate':'unchanged',changed,publishedAt:candidate.publishedAt,models:candidate.models.length,retrieval:candidate.retrieval});
        }
      } catch(error){
        const reason=error instanceof Error?`${error.message}${error.cause instanceof Error?` (${error.cause.message})`:''}`:String(error);
        results.push({category,status:'failed',changed:false,reason});
        console.error(`${category} 同步失败，保留该分类原数据与历史：${reason}`);
      }
    }
    const changed=Object.keys(files).length>0;
    if(changed && apply){
      await stageAndValidate(process.cwd(),files,async()=>{
        await run(['run','validate:workflows']);await run(['test']);await run(['run','build']);await run(['run','validate:build']);
      });
      results.forEach(result=>{if(result.changed)result.status='updated';});
    }
    const failed=results.filter(result=>result.status==='failed').length;
    const report={checkedAt:new Date().toISOString(),status:failed?(failed===results.length?'failed':'partial'):(changed?(apply?'updated':'candidate'):'unchanged'),changed,results};
    await atomicWrite('reports/performance-update.json',json(report));
    if(process.env.GITHUB_OUTPUT)await appendFile(process.env.GITHUB_OUTPUT,`changed=${changed}\n`);
    if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,results.map(result=>`Arena ${result.category}：${result.status}${'reason' in result?`（保留旧数据：${result.reason}）`:`，${result.models} 条，来源日期 ${result.publishedAt}`}。`).join('\n')+'\n');
    console.log(json(report));
    if(!changed)console.log('没有有效数据变化，不写快照、不追加历史、不创建提交。');
    if(failed===results.length)process.exitCode=1;
  } catch(error){
    const reason=error instanceof Error?error.message:String(error);
    await atomicWrite('reports/performance-update.json',json({checkedAt:new Date().toISOString(),status:'failed',changed:false,reason}));
    if(process.env.GITHUB_OUTPUT)await appendFile(process.env.GITHUB_OUTPUT,'changed=false\n');
    console.error(`性能榜同步失败，保留原始数据与历史：${reason}`);process.exitCode=1;
  }
});
