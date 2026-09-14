import { catalog } from '../lib/catalog';
import data from '../data/pelican.json';
import { defaultPelicanFilters, getPelicanCounts, getPelicanRows, parsePelicanFilters, pelicanSchema, serializePelicanFilters, type PelicanFilters } from '../lib/pelican';
import { renderPelicanLeaders, renderPelicanTiers } from '../lib/pelican-render';
import { captureRows, animateRows } from './motion';
import { bindSearch, bindResponsiveFilters } from './controls';

const board = pelicanSchema.parse(data);
const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const base = byId('main').dataset.base!;
const search = byId<HTMLInputElement>('pelican-search');
let state = parsePelicanFilters(location.search);
const searchInput = bindSearch(search, query => update({ query }, true));

function render(animate = true) {
  const positions = animate ? captureRows() : new Map<string, DOMRect>();
  const rows = getPelicanRows(board, catalog, state);
  const counts = getPelicanCounts(rows);
  const columnHead = byId('pelican-list').querySelector<HTMLElement>('.pelican-column-head')!;
  columnHead.classList.toggle('pelican-column-head-pending', !counts.verified);
  columnHead.innerHTML = `${counts.verified ? '<span>档位</span>' : ''}<span>模型与评分</span><span>测试作品</span>`;
  const tiers = byId('pelican-tiers');
  const expanded = [...tiers.querySelectorAll<HTMLDetailsElement>('.pelican-assessment[open]')].map(detail => detail.closest<HTMLElement>('[data-model-id]')!.dataset.modelId);
  tiers.innerHTML = renderPelicanTiers(rows, catalog, base, state.order);
  tiers.querySelectorAll<HTMLDetailsElement>('.pelican-assessment').forEach(detail => detail.open = expanded.includes(detail.closest<HTMLElement>('[data-model-id]')!.dataset.modelId));
  tiers.dataset.order = state.order;
  byId('pelican-leaders').innerHTML = renderPelicanLeaders(rows, catalog, base, board.entries.length > 0);
  byId('pelican-leaders').setAttribute('aria-label', counts.verified ? '当前筛选的领先正式成绩，同分并列' : '当前筛选的作品和核验状态');
  byId('pelican-count').textContent = String(rows.length);
  byId('pelican-summary').textContent = counts.verified
    ? `显示 ${counts.verified} 份正式成绩，${state.order === 'desc' ? '从夯到拉' : '从拉到夯'}${counts.provisional ? `；另有 ${counts.provisional} 份作品待核验` : ''}`
    : `显示 ${counts.provisional} 份待核验作品，按提交顺序展示，暂不排名`;
  const empty = rows.length === 0 && (board.entries.length > 0 || !!state.query || state.providers.length > 0);
  byId('pelican-empty').hidden = !empty;
  byId('pelican-list').hidden = empty;
  byId<HTMLInputElement>('pelican-all').checked = !state.providers.length;
  byId<HTMLSelectElement>('pelican-order').value = state.order;
  byId<HTMLSelectElement>('pelican-order').disabled = !counts.verified;
  byId<HTMLSelectElement>('pelican-order').title = counts.verified ? '正式成绩的档位顺序；待核验作品始终按提交顺序展示' : '正式成绩核验后可按档位排序';
  if (document.activeElement !== search && !searchInput.composing) search.value = state.query;
  document.querySelectorAll<HTMLInputElement>('[name="pelican-provider"]').forEach(input => input.checked = state.providers.includes(input.value));
  if (animate) animateRows(positions);
}

function update(patch: Partial<PelicanFilters>, replace = false) {
  state = { ...state, query: searchInput.read(state.query), ...patch };
  const url = `${location.pathname}${serializePelicanFilters(state)}${location.hash}`;
  if (url !== `${location.pathname}${location.search}${location.hash}`) history[replace ? 'replaceState' : 'pushState'](null, '', url);
  render();
}
const reset = () => { searchInput.restore(''); update({ ...defaultPelicanFilters, providers: [] }); };
byId('pelican-reset').addEventListener('click', reset);
byId('pelican-empty-reset').addEventListener('click', reset);
byId('pelican-all').addEventListener('change', () => update({ providers: [] }));
document.querySelectorAll<HTMLInputElement>('[name="pelican-provider"]').forEach(input => input.addEventListener('change', () => update({ providers: [...document.querySelectorAll<HTMLInputElement>('[name="pelican-provider"]:checked')].map(box => box.value) })));
byId<HTMLSelectElement>('pelican-order').addEventListener('change', event => update({ order: (event.target as HTMLSelectElement).value === 'asc' ? 'asc' : 'desc' }));
document.querySelectorAll<HTMLAnchorElement>('[data-pelican-provider]').forEach(link => link.addEventListener('click', event => {
  if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  update({ providers: [link.dataset.pelicanProvider!] });
  byId('ranking-title').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
}));
window.addEventListener('popstate', () => { state = parsePelicanFilters(location.search); searchInput.restore(state.query); render(); });
bindResponsiveFilters(byId<HTMLDetailsElement>('pelican-filters'));

// Media failures are presentation failures, never model assessment failures.
document.addEventListener('error', event => {
  if (!(event.target instanceof HTMLVideoElement) || !event.target.hasAttribute('data-pelican-video')) return;
  const fallback = event.target.closest('.pelican-media')?.querySelector<HTMLElement>('[data-pelican-media-error]');
  if (fallback) fallback.hidden = false;
}, true);
document.addEventListener('loadeddata', event => {
  if (!(event.target instanceof HTMLVideoElement) || !event.target.hasAttribute('data-pelican-video')) return;
  const fallback = event.target.closest('.pelican-media')?.querySelector<HTMLElement>('[data-pelican-media-error]');
  if (fallback) fallback.hidden = true;
}, true);

let toastTimer: ReturnType<typeof setTimeout>;
byId('pelican-share').addEventListener('click', async () => {
  const query = searchInput.read(state.query);
  if (query !== state.query) update({ query }, true);
  const url = `${location.origin}${location.pathname}${serializePelicanFilters(state)}${location.hash}`;
  try {
    await navigator.clipboard.writeText(url);
    const toast = byId('pelican-toast');
    toast.textContent = '榜单链接已复制';
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.hidden = true, 2200);
  } catch {
    byId<HTMLInputElement>('pelican-share-url').value = url;
    byId<HTMLDialogElement>('pelican-share-dialog').showModal();
  }
});
byId('pelican-close-share').addEventListener('click', () => byId<HTMLDialogElement>('pelican-share-dialog').close());
byId('pelican-select-share').addEventListener('click', () => { const input = byId<HTMLInputElement>('pelican-share-url'); input.focus(); input.select(); });
render(false);
