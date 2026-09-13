import { readFile, writeFile, rename, mkdir, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { catalogSchema, type Catalog } from '../../src/lib/schema';
import { exchangeRateSchema, verificationFileSchema, historySchema, type VerificationFile } from '../../src/lib/pricing-metadata';
import { hash, meaningfulCatalog } from './diff';
export function selectVerifiedState(catalog:Catalog, current:VerificationFile, saved:VerificationFile):VerificationFile {
  return saved.catalogHash===hash(meaningfulCatalog(catalog)) && !!saved.checkedAt && (!current.checkedAt||saved.checkedAt>current.checkedAt) ? saved : current;
}
export const dataPaths = ['src/data/catalog.json','src/data/price-history.json','src/data/verification.json'] as const;
export const json = (value: unknown) => JSON.stringify(value,null,2)+'\n';
export async function readJson(path: string): Promise<unknown> { return JSON.parse(await readFile(path,'utf8')); }
export async function loadData(root=process.cwd()) {
  const raw=await readJson(join(root,dataPaths[0])) as Catalog;
  const exchange=exchangeRateSchema.parse(await readJson(join(root,'src/data/exchange-rates.json')));
  const catalog=catalogSchema.parse({...raw,meta:{...raw.meta,usdToCny:exchange.rate,exchangeRateNote:exchange.note}});
  const history=historySchema.parse(await readJson(join(root,dataPaths[1])));
  const verification=verificationFileSchema.parse(await readJson(join(root,dataPaths[2])));
  return {catalog,history,verification,exchange};
}
export function diskCatalog(catalog: Catalog) {
  const {usdToCny:_fx,exchangeRateNote:_note,...meta}=catalog.meta;
  return {...catalog,meta,models:catalog.models.map(({verification:_verification,...m})=>m)};
}
export async function atomicWrite(path: string, value:string) {
  await mkdir(dirname(path),{recursive:true}); const temporary=`${path}.${process.pid}.tmp`;
  try{await writeFile(temporary,value);await rename(temporary,path);}finally{await rm(temporary,{force:true});}
}
export async function withLock<T>(root:string, run:()=>Promise<T>):Promise<T> {
  const path=join(root,'.price-update.lock');
  try{await mkdir(path);}catch(error){if((error as NodeJS.ErrnoException).code==='EEXIST')throw new Error('另一个价格更新正在执行；拒绝并发覆盖');throw error;}
  try{return await run();}finally{await rm(path,{recursive:true,force:true});}
}
export async function stageAndValidate(root:string, files:Record<string,string>, validate:()=>Promise<void>) {
  const backup=new Map<string,string|null>();
  for(const path of Object.keys(files)){try{backup.set(path,await readFile(join(root,path),'utf8'));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;backup.set(path,null);}}
  try{for(const [path,value]of Object.entries(files))await atomicWrite(join(root,path),value);await validate();}
  catch(error){for(const [path,value]of backup){if(value===null)await rm(join(root,path),{force:true});else await atomicWrite(join(root,path),value);}throw error;}
}
