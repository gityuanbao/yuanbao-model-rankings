import { loadData, readJson, selectVerifiedState, atomicWrite, json } from './pricing/io';
import { verificationFileSchema } from '../src/lib/pricing-metadata';
const path='reports/previous-verification.json';
try{
  const {catalog,verification}=await loadData();
  const saved=verificationFileSchema.parse(await readJson(path));
  const selected=selectVerifiedState(catalog,verification,saved);
  if(selected!==verification){await atomicWrite('src/data/verification.json',json(selected));console.log('恢复与当前价格快照一致的最近核验状态；无 Git 提交。');}
  else console.log('历史状态不匹配当前价格或并非更新记录，沿用仓库核验状态。');
}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')console.log('首次运行，无历史状态 artifact。');else throw error;}
