import { captureRows, animateRows } from './motion';
import { catalog } from '../lib/catalog';
import { defaultFilters, getRows, metricLabels, scenarios, type Filters, type Metric, type Scenario } from '../lib/ranking';
import { parseFilters, serializeFilters } from '../lib/url-state';
import { renderChampions, renderMobileRows, renderRows, renderTableHead, renderPriceCoverage } from '../lib/render';
import { bindSearch, bindResponsiveFilters } from './controls';

const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const field = (id: string) => byId<HTMLInputElement | HTMLSelectElement>(id);
const base = byId('main').dataset.base!;
let state = parseFilters(location.search);
let toastTimer: ReturnType<typeof setTimeout>;
const search = byId<HTMLInputElement>('search');
const searchInput = bindSearch(search, query => update({ query }, true, false), 180);
function toast(message: string) {
  clearTimeout(toastTimer);
  byId('toast').textContent = message;
  byId('toast').hidden = false;
  toastTimer = setTimeout(() => { byId('toast').hidden = true; }, 3200);
}
function render(sync = true, animate = true) {
  const positions = animate ? captureRows() : new Map<string, DOMRect>();
  const focusedColumn = document.activeElement?.closest<HTMLButtonElement>('[data-sort-column]')?.dataset.metric;
  const { rows, unavailable } = getRows(catalog, state);
  byId('champions').innerHTML = renderChampions(rows, catalog, state, base);
  byId('table-head').innerHTML = renderTableHead(state.metric, state.order);
  byId('table-body').innerHTML = renderRows(rows, catalog, state, base);
  byId('mobile-results').innerHTML = renderMobileRows(rows, catalog, state, base);
  byId('result-count').textContent = String(rows.length);
  byId('empty-state').hidden = rows.length > 0;
  const coverage = renderPriceCoverage(catalog, state, base);
  byId('price-coverage').innerHTML = coverage;
  byId('price-coverage').hidden = !coverage;
  byId('empty-state').querySelector('h3')!.textContent = coverage ? '价格待核验' : '没有找到符合条件的模型';
  byId('empty-state').querySelector('p')!.textContent = coverage ? '相关型号完成官方价格核验后会加入榜单。' : '尝试减少筛选条件，或调整任务的 Token 数量。';
  const pending = state.providers.map(id => catalog.providers.find(p => p.id === id)).filter(p => p?.pendingReason);
  byId('results-summary').textContent = `显示 ${rows.length} 条模型费率 · ${metricLabels[state.metric]}${state.order === 'asc' ? '从低到高' : '从高到低'}${unavailable ? ` · ${unavailable} 条超出长度限制或缺少该长度费率` : ''}${pending.length ? ` · ${pending.map(p => p!.shortName).join('、')}费率待核验` : ''}`;
  byId('results-footer').classList.toggle('sr-only', !unavailable && !pending.length);
  const summary = `${state.inputTokens.toLocaleString('zh-CN')} 输入 + ${state.outputTokens.toLocaleString('zh-CN')} 输出 Token`;
  byId('scenario-summary').textContent = summary;
  byId('max-price-label').textContent = `${metricLabels[state.metric]}上限`;
  byId('max-price-unit').textContent = state.metric === 'task' ? '每次任务' : '每百万 Token';
  byId('token-form').hidden = state.scenario !== 'custom';
  byId('cache-control').hidden = state.billing !== 'cache';
  const applied = rows.filter(row => row.applied === state.billing && state.billing !== 'standard').length;
  const notes = {
    standard: '',
    cache: `${applied} 条使用缓存读取估算；不含首次写入和存储费，未核验的按标准价计算`,
    batch: `${applied} 条使用批量优惠；需异步批量请求，不支持的按标准价计算`,
    offpeak: `${applied} 条使用低峰优惠；需在厂商规定时段调用，其余按标准价计算`,
    promotion: `${applied} 条有已核验且仍有效的促销；其余按标准价计算`,
  };
  byId('billing-note').textContent = notes[state.billing];
  byId('billing-note').hidden = state.billing === 'standard';
  document.querySelectorAll<HTMLButtonElement>('[data-scenario]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.scenario === state.scenario)));
  if (focusedColumn) document.querySelector<HTMLButtonElement>(`[data-sort-column][data-metric="${focusedColumn}"]`)?.focus({ preventScroll: true });
  if (animate) animateRows(positions);
  if (sync) {
    const values: Record<string, string> = { 'sort-metric': state.metric, 'sort-order': state.order, search: state.query, 'max-price': state.maxPrice === null ? '' : String(state.maxPrice), 'min-context': String(state.minContext), 'model-status': state.status, region: state.region, 'use-case': state.useCase, billing: state.billing, 'cache-percent': String(state.cachePercent), 'input-tokens': String(state.inputTokens), 'output-tokens': String(state.outputTokens) };
    // Preserve valid custom context thresholds received from shared URLs.
    const context = byId<HTMLSelectElement>('min-context');
    if (![...context.options].some(option => option.value === String(state.minContext))) context.add(new Option(`至少 ${state.minContext.toLocaleString('zh-CN')} Token`, String(state.minContext)));
    Object.entries(values).forEach(([id, value]) => { if (id !== 'search' || !searchInput.composing) field(id).value = value; });
    byId<HTMLInputElement>('all-providers').checked = !state.providers.length;
    document.querySelectorAll<HTMLInputElement>('[name="provider"]').forEach(input => { input.checked = state.providers.includes(input.value); });
  }
}
function update(patch: Partial<Filters>, replace = false, sync = true) {
  state = { ...state, query: searchInput.read(state.query), ...patch };
  const url = `${location.pathname}${serializeFilters(state)}${location.hash}`;
  if (url !== `${location.pathname}${location.search}${location.hash}`) history[replace ? 'replaceState' : 'pushState'](null, '', url);
  render(sync);
}
document.querySelectorAll<HTMLAnchorElement>('[data-provider-shortcut]').forEach(link => link.addEventListener('click', event => {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  update({ providers: [link.dataset.providerShortcut!] });
  byId('ranking-title').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
}));
const reset = () => { searchInput.restore(''); update({ ...defaultFilters, providers: [] }); };
byId('reset-filters').addEventListener('click', reset);
byId('empty-reset').addEventListener('click', reset);
byId('all-providers').addEventListener('change', () => update({ providers: [] }));
document.querySelectorAll<HTMLInputElement>('[name="provider"]').forEach(input => input.addEventListener('change', () => {
  update({ providers: [...document.querySelectorAll<HTMLInputElement>('[name="provider"]:checked')].map(box => box.value) });
}));
document.addEventListener('click', event => {
  const button = (event.target as Element).closest<HTMLButtonElement>('button[data-sort-column], button[data-scenario]');
  if (!button) return;
  if (button.dataset.metric) {
    const metric = button.dataset.metric as Metric;
    const toggling = button.hasAttribute('data-sort-column') && metric === state.metric;
    update({ metric, order: toggling ? (state.order === 'asc' ? 'desc' : 'asc') : state.order, maxPrice: metric === state.metric ? state.maxPrice : null });
  }
  if (button.dataset.scenario) {
    const scenario = button.dataset.scenario as Scenario;
    update(scenario === 'custom' ? { scenario } : { scenario, inputTokens: scenarios[scenario].input, outputTokens: scenarios[scenario].output });
    if (scenario === 'custom') field('input-tokens').focus();
  }
});
const filterMappings = { 'sort-order': 'order', 'min-context': 'minContext', 'model-status': 'status', region: 'region', 'use-case': 'useCase', billing: 'billing' } as const;
Object.entries(filterMappings).forEach(([id, key]) => field(id).addEventListener('change', () => update({ [key]: key === 'minContext' ? Number(field(id).value) : field(id).value })));
field('sort-metric').addEventListener('change', () => {
  const metric = field('sort-metric').value as Metric;
  update({ metric, maxPrice: metric === state.metric ? state.maxPrice : null });
});
field('max-price').addEventListener('change', () => {
  const input = byId<HTMLInputElement>('max-price');
  if (!input.reportValidity()) return;
  update({ maxPrice: input.value === '' ? null : Number(input.value) });
});
field('cache-percent').addEventListener('change', () => {
  const input = byId<HTMLInputElement>('cache-percent');
  if (!input.value || !input.reportValidity()) { input.value = String(state.cachePercent); return; }
  update({ cachePercent: Number(input.value) });
});
byId<HTMLFormElement>('token-form').addEventListener('submit', event => {
  event.preventDefault();
  if (!byId<HTMLFormElement>('token-form').reportValidity()) return;
  update({ scenario: 'custom', inputTokens: Number(field('input-tokens').value), outputTokens: Number(field('output-tokens').value) });
});
window.addEventListener('popstate', () => { state = parseFilters(location.search); searchInput.restore(state.query); render(); });
byId('share').addEventListener('click', async () => {
  const query = searchInput.read(state.query);
  if (query !== state.query) update({ query }, true);
  const url = new URL(`${location.pathname}${serializeFilters(state)}`, location.origin).href;
  try { await navigator.clipboard.writeText(url); toast('榜单链接已复制，包含当前筛选、排序与任务参数'); }
  catch { field('share-url').value = url; byId<HTMLDialogElement>('share-dialog').showModal(); byId<HTMLInputElement>('share-url').select(); }
});
byId('close-share').addEventListener('click', () => byId<HTMLDialogElement>('share-dialog').close());
byId('select-share').addEventListener('click', () => byId<HTMLInputElement>('share-url').select());
bindResponsiveFilters(byId<HTMLDetailsElement>('filter-panel'));
render(true, false);
