import { catalog } from '../lib/catalog';
import { performanceBoards } from '../lib/performance-data';
import { performanceCategories, type PerformanceCategory } from '../lib/performance-categories';
import { pathFor } from '../lib/render';
import { defaultPerformanceFilters, getPerformanceRows, parsePerformanceFilters, serializePerformanceFilters, type PerformanceFilters } from '../lib/performance';
import { renderPerformanceLeaders, renderPerformanceMobile, renderPerformanceRows } from '../lib/performance-render';
import { captureRows, animateRows } from './motion';
import { bindSearch, bindResponsiveFilters, bindDetailsLinks } from './controls';

const byId = <T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
const base = byId('main').dataset.base!;
let state = parsePerformanceFilters(location.search);
let toastTimer: ReturnType<typeof setTimeout>;
const search = byId<HTMLInputElement>('performance-search');
const searchInput = bindSearch(search, query => update({ query }, true));
function render(animate=true) {
  const positions = animate ? captureRows() : new Map<string,DOMRect>();
  const performance=performanceBoards[state.category];
  const category=performanceCategories[state.category];
  const agent=state.category==='agent';
  const rows = getPerformanceRows(performance,catalog,state);
  byId('performance-body').innerHTML = renderPerformanceRows(rows,catalog,base);
  byId('performance-mobile').innerHTML = renderPerformanceMobile(rows,catalog,base);
  byId('performance-leaders').innerHTML = renderPerformanceLeaders(rows,catalog,base);
  byId('performance-count').textContent = String(rows.length);
  byId('performance-summary').textContent = `${category.label}：显示 ${rows.length} 条模型与测试配置，${agent?'官方综合排名':'得分排序'}${state.order==='desc'?'由前到后':'由后到前'}`;
  byId('performance-empty').hidden = rows.length > 0;
  byId('performance-score-heading').removeAttribute('aria-sort');
  byId('performance-rank-heading').removeAttribute('aria-sort');
  byId('performance-score-heading').setAttribute('aria-sort',agent?(state.order==='desc'?'ascending':'descending'):(state.order==='desc'?'descending':'ascending'));
  const sortLabel=agent?'原榜综合名次':'Arena 得分';
  byId('performance-sort-label').textContent=sortLabel;
  byId('performance-sort-score').setAttribute('aria-label',`${sortLabel}，点击切换排序方向`);
  byId('performance-reference-heading').textContent=agent?'净提升':'原榜名次';
  byId('performance-sample-heading').textContent=agent?'评估会话':'对战票数';
  byId('performance-agent-note').hidden=!agent;
  byId('performance-sort-arrow').textContent = agent?(state.order==='desc'?'↑':'↓'):(state.order==='desc'?'↓':'↑');
  byId<HTMLInputElement>('performance-all').checked = !state.providers.length;
  const order=byId<HTMLSelectElement>('performance-order');
  order.options[0].textContent=agent?'官方排名从前到后':'得分从高到低';
  order.options[1].textContent=agent?'官方排名从后到前':'得分从低到高';
  order.value=state.order;
  byId('performance-category-label').textContent=`Arena · ${category.label}`;
  const source=byId<HTMLAnchorElement>('performance-method-source');source.href=performance.sourceUrl ?? category.url;source.textContent=`Arena · ${category.label}`;
  byId('performance-method-description').textContent=category.method;
  const rounded='scorePrecision' in performance.models[0] && performance.models[0].scorePrecision==='rounded';
  byId('performance-precision-note').textContent=agent?'排名沿用官方 Overall 顺序，表内净提升与各项信号仅供参考，不能当作文本榜的 Arena 得分比较。':rounded?'保留官网整数分与 ± 区间，以及原榜顺序；相同整数分不推断为并列。小分差不一定代表稳定胜出。':'分数下方为 95% 置信区间，小分差不一定代表稳定胜出。';
  byId('performance-license').hidden=state.category!=='text'||rounded;
  byId<HTMLAnchorElement>('performance-snapshot-link').href=pathFor(base,state.category==='text'?'data/performance.json':'data/performance-categories.json');
  const exclusions=byId('performance-exclusions');
  const excluded='excludedModels' in performance?performance.excludedModels:undefined;
  exclusions.hidden=!excluded?.length;
  exclusions.textContent=excluded?.map(item=>`${item.sourceModel}（原榜 ${item.sourceRanks.join(' / ')}）：${item.reason}。`).join('') ?? '';
  const published=byId('performance-published');
  published.textContent='榜单日期 ';
  const time=document.createElement('time');time.dateTime=performance.publishedAt;time.textContent=performance.publishedAt;published.append(time);
  if(Date.now()-Date.parse(performance.publishedAt)>30*24*60*60*1000)published.append(' · 本站快照超过 30 天，待重新核验');
  byId('performance-total').textContent=String(performance.models.length);
  document.querySelectorAll<HTMLElement>('[data-performance-provider-count]').forEach(element=>element.textContent=String(performance.models.filter(model=>model.providerId===element.dataset.performanceProviderCount).length));
  document.querySelectorAll<HTMLButtonElement>('[data-performance-category]').forEach(button=>{
    button.setAttribute('aria-pressed',String(button.dataset.performanceCategory===state.category));
  });
  document.querySelectorAll<HTMLAnchorElement>('[data-performance-provider]').forEach(link=>link.href=`${location.pathname}${serializePerformanceFilters({...state,providers:[link.dataset.performanceProvider!]})}#ranking-title`);
  if (document.activeElement !== search && !searchInput.composing) search.value = state.query;
  document.querySelectorAll<HTMLInputElement>('[name="performance-provider"]').forEach(input=>input.checked=state.providers.includes(input.value));
  if (animate) animateRows(positions);
}
function update(patch:Partial<PerformanceFilters>, replace=false) {
  state = {...state,query:searchInput.read(state.query),...patch};
  const url = `${location.pathname}${serializePerformanceFilters(state)}${location.hash}`;
  if (url !== `${location.pathname}${location.search}${location.hash}`) history[replace?'replaceState':'pushState'](null,'',url);
  render();
}
document.querySelectorAll<HTMLButtonElement>('[data-performance-category]').forEach(button=>button.addEventListener('click',()=>{
  update({category:button.dataset.performanceCategory as PerformanceCategory});
}));
const reset=()=>{ searchInput.restore(''); update({...defaultPerformanceFilters,category:state.category,providers:[]}); };
byId('performance-reset').addEventListener('click',reset);
byId('performance-empty-reset').addEventListener('click',reset);
byId('performance-all').addEventListener('change',()=>update({providers:[]}));
document.querySelectorAll<HTMLInputElement>('[name="performance-provider"]').forEach(input=>input.addEventListener('change',()=>update({providers:[...document.querySelectorAll<HTMLInputElement>('[name="performance-provider"]:checked')].map(box=>box.value)})));
byId('performance-sort-score').addEventListener('click',()=>update({order:state.order==='desc'?'asc':'desc'}));
byId<HTMLSelectElement>('performance-order').addEventListener('change',event=>update({order:(event.target as HTMLSelectElement).value as 'asc'|'desc'}));
document.querySelectorAll<HTMLAnchorElement>('[data-performance-provider]').forEach(link=>link.addEventListener('click',event=>{
  if(event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)return;
  event.preventDefault(); update({providers:[link.dataset.performanceProvider!]});
  byId('ranking-title').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});
}));
window.addEventListener('popstate',()=>{state=parsePerformanceFilters(location.search);searchInput.restore(state.query);render();});
byId('share').addEventListener('click',async()=>{
  const query=searchInput.read(state.query);
  if(query!==state.query)update({query},true);
  const url=new URL(`${location.pathname}${serializePerformanceFilters(state)}`,location.origin).href;
  try {
    await navigator.clipboard.writeText(url);
    clearTimeout(toastTimer);
    byId('toast').textContent='榜单链接已复制，包含当前分类、筛选与排序';
    byId('toast').hidden=false;
    toastTimer=setTimeout(()=>{byId('toast').hidden=true;},3200);
  } catch {
    const input=byId<HTMLInputElement>('share-url');
    input.value=url;
    byId<HTMLDialogElement>('share-dialog').showModal();
    input.focus();input.select();
  }
});
byId('close-share').addEventListener('click',()=>byId<HTMLDialogElement>('share-dialog').close());
byId('select-share').addEventListener('click',()=>byId<HTMLInputElement>('share-url').select());
bindResponsiveFilters(byId<HTMLDetailsElement>('performance-filters'));
bindDetailsLinks(byId<HTMLDetailsElement>('performance-method'));
render(false);
