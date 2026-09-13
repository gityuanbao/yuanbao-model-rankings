import { spawn } from 'node:child_process';
import { addReviewedModels } from './pricing/add-reviewed';
import { loadData, withLock, readJson, stageAndValidate, diskCatalog, json } from './pricing/io';
const file=process.argv.find(arg=>arg.startsWith('--from-file='))?.slice('--from-file='.length);
if(!file)throw new Error('需要 --from-file=已核对的官方价格清单.json');
const apply=process.argv.includes('--apply');
const run=(args:string[])=>new Promise<void>((resolve,reject)=>{
  const child=spawn('npm',args,{stdio:'inherit',env:{...process.env,ASTRO_TELEMETRY_DISABLED:'1'}});
  child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error(`npm ${args.join(' ')} 失败，恢复原目录与历史`)));
});
await withLock(process.cwd(),async()=>{
  const result=addReviewedModels(await loadData(),await readJson(file),new Date().toISOString());
  if(apply&&result.added.length)await stageAndValidate(process.cwd(),{
    'src/data/catalog.json':json(diskCatalog(result.catalog)),
    'src/data/price-history.json':json(result.history),
    'src/data/verification.json':json(result.verification),
  },async()=>{await run(['run','validate:workflows']);await run(['test']);await run(['run','build']);await run(['run','validate:build']);});
  console.log(json({status:result.added.length?(apply?'added':'candidate'):'unchanged',added:result.added,total:result.catalog.models.length}));
});
