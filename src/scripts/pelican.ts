import { catalog } from '../lib/catalog';
import { defaultPelicanFilters, parsePelicanFilters, serializePelicanFilters, type PelicanFilters } from '../lib/pelican';
import { getPelicanShowcaseRows, renderPelicanShowcase, type PelicanShowcaseEntry } from '../lib/pelican-showcase';
import { mountPelicanThumbnails } from './pelican-thumbnails';
import { captureRows, animateRows } from './motion';
import { bindSearch, bindResponsiveFilters } from './controls';

const entries = JSON.parse(document.getElementById('pelican-showcase-data')!.textContent!) as PelicanShowcaseEntry[];
const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const base = byId('main').dataset.base!;
const search = byId<HTMLInputElement>('pelican-search');
const readState = (): PelicanFilters => ({ ...parsePelicanFilters(location.search), order: 'desc' });
let state = readState();
if (new URLSearchParams(location.search).has('order')) history.replaceState(null, '', `${location.pathname}${serializePelicanFilters(state)}${location.hash}`);
let disposePreviews = () => {};
const searchInput = bindSearch(search, query => update({ query }, true));

function render(animate = true) {
  const positions = animate ? captureRows() : new Map<string, DOMRect>();
  const rows = getPelicanShowcaseRows(entries, catalog, state);
  const works = byId('pelican-works');
  disposePreviews();
  works.innerHTML = renderPelicanShowcase(rows, catalog, base);
  disposePreviews = mountPelicanThumbnails(works);
  byId('pelican-count').textContent = String(rows.length);
  byId('pelican-summary').textContent = `显示 ${rows.length} 份 HTML 作品，按提交顺序展示，暂不评分和排名`;
  const empty = rows.length === 0 && (entries.length > 0 || !!state.query || state.providers.length > 0);
  byId('pelican-empty').hidden = !empty;
  byId('pelican-list').hidden = empty;
  byId<HTMLInputElement>('pelican-all').checked = !state.providers.length;
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
document.querySelectorAll<HTMLAnchorElement>('[data-pelican-provider]').forEach(link => link.addEventListener('click', event => {
  if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  update({ providers: [link.dataset.pelicanProvider!] });
  byId('ranking-title').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
}));
window.addEventListener('popstate', () => { state = readState(); searchInput.restore(state.query); render(); });
bindResponsiveFilters(byId<HTMLDetailsElement>('pelican-filters'));

window.addEventListener('pagehide', () => disposePreviews());
window.addEventListener('pageshow', event => { if (event.persisted) render(false); });

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
