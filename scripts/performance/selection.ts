import { createHash } from 'node:crypto';
import type { PerformanceSelection } from '../../src/lib/performance-schema';

export const organizations: Record<string,string> = {openai:'openai', anthropic:'anthropic', google:'google', xai:'xai', spacexai:'xai', deepseek:'deepseek', bytedance:'bytedance', alibaba:'alibaba', moonshot:'moonshot', moonshotai:'moonshot', zai:'zhipu', zhipu:'zhipu', minimax:'minimax', baidu:'baidu', tencent:'tencent'};
export const providerFor = (organization:string) => organizations[organization.toLowerCase().replace(/[^a-z0-9]/g,'')];
const families:Record<string,RegExp> = {
  openai:/^(gpt-|chatgpt-|o[1-9](?:-|$))/i, anthropic:/^claude-/i, google:/^(gemini|gemma|palm)-/i,
  xai:/^grok-/i, deepseek:/^deepseek-/i, bytedance:/^(dola|doubao|seed)-/i,
  alibaba:/^(qwen|qwq)(?:[0-9.-]|$)/i, moonshot:/^(kimi|moonshot)-/i,
  zhipu:/^(glm-|chatglm)/i, minimax:/^minimax-/i, baidu:/^ernie-/i, tencent:/^(hunyuan-|hy\d)/i,
};
export function isMainstreamModel(sourceModel:string, providerId:string) {
  return !!families[providerId]?.test(sourceModel) && !/(?:^|-)(?:anonymous|community|finetune|uncensored|simpo|merge)(?:-|$)/i.test(sourceModel);
}
export function selectionFor(sourceModel:string, providerId:string, selection:PerformanceSelection):PerformanceSelection['models'][number] | undefined {
  const known=selection.models.find(m=>m.sourceModel===sourceModel);
  if (known) return known.providerId===providerId ? known : undefined;
  if (!selection.includeProviderFamilies || !isMainstreamModel(sourceModel,providerId)) return;
  let name=sourceModel;
  let mode:string|undefined;
  const suffix=name.match(/(?:-((?:xhigh|high|medium|low|max)(?:-\d+k)?))$/i);
  // Qwen Max is a product name, unlike the Max evaluation setting used by
  // other model families. Keep it in the name, including for future versions.
  const productSuffix=providerId==='alibaba' && /^max(?:-\d+k)?$/i.test(suffix?.[1] ?? '');
  if(suffix && !productSuffix){mode=suffix[1].replace(/^xhigh/i,'xHigh').replace(/^high/i,'High').replace(/^medium/i,'Medium').replace(/^low/i,'Low').replace(/^max/i,'Max');name=name.slice(0,-suffix[0].length);}
  if(providerId==='anthropic') name=name.replace(/^(claude-(?:opus|sonnet|haiku))-([3-9])-([0-9])(?=-|$)/,'$1-$2.$3');
  if(providerId==='minimax') name=name.replace(/^(minimax-)m(?=\d)/i,'$1M');
  if(providerId==='deepseek') name=name.replace(/^(deepseek-)([rv])(?=\d)/i,(_,prefix,version)=>prefix+version.toUpperCase());
  if(providerId==='moonshot') name=name.replace(/^(kimi-)k(?=\d)/i,'$1K');
  name=name.replace(/^gpt-/i,'GPT-').replace(/^chatgpt-/i,'ChatGPT-').replace(/^claude-/i,'Claude ').replace(/^gemini-/i,'Gemini ').replace(/^gemma-/i,'Gemma ').replace(/^grok-/i,'Grok ').replace(/^deepseek-/i,'DeepSeek ').replace(/^qwen/i,'Qwen').replace(/^qwq/i,'QwQ').replace(/^kimi-/i,'Kimi ').replace(/^glm-/i,'GLM-').replace(/^minimax-/i,'MiniMax ').replace(/^ernie-/i,'文心 ERNIE ').replace(/^hunyuan-/i,'混元 ').replace(/^hy(\d)/i,'混元 Hy$1').replace(/^dola-seed-/i,'豆包 Seed ').replace(/^doubao-/i,'豆包 ');
  name=name.replace(/\b(astra|sol|terra|luna|flash|lite|pro|opus|sonnet|haiku|fable|seed|turbo|preview|instruct|thinking|instant|max|plus)\b/gi,v=>v[0].toUpperCase()+v.slice(1).toLowerCase()).replace(/(?<=[a-z])-+(?=[a-z])/gi,' ').replace(/(?<=\d)-(?=[A-Z])/g,' ');
  const slug=sourceModel.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
  return {id:`arena-${slug}-${createHash('sha256').update(sourceModel).digest('hex').slice(0,8)}`,providerId:providerId as PerformanceSelection['models'][number]['providerId'],name,...(mode?{mode}:{}),sourceModel};
}
