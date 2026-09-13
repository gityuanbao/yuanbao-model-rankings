import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { catalog } from '../src/lib/catalog';
import { performanceBoards } from '../src/lib/performance-data';
import { performanceCategories } from '../src/lib/performance-categories';
import data from '../src/data/pelican.json';
import * as ranking from '../src/lib/ranking';
import * as urlState from '../src/lib/url-state';
import * as priceRender from '../src/lib/render';
import * as performance from '../src/lib/performance';
import * as performanceRender from '../src/lib/performance-render';
import * as pelican from '../src/lib/pelican';
import * as pelicanRender from '../src/lib/pelican-render';

// Execute the real clients with deterministic DOM/event/timer doubles. This covers
// the input -> filter -> history/share integration, not just query serialization.
class ElementDouble {
  value = ''; textContent = ''; innerHTML = ''; hidden = false; checked = false; open = false;
  dataset: Record<string, string> = {}; attributes = new Map<string, string>();
  listeners = new Map<string, ((event: any) => unknown)[]>();
  children = new Map<string, ElementDouble>(); options = [{ value: '0', textContent: '' }, { value: 'asc', textContent: '' }];
  classList = { toggle() {} }; focused = false;
  constructor(public id: string) {}
  addEventListener(type: string, callback: (event: any) => unknown) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), callback]); }
  async emit(type: string, patch: Record<string, unknown> = {}) {
    const event = { button: 0, target: this, preventDefault() {}, ...patch };
    for (const listener of this.listeners.get(type) ?? []) await listener(event);
  }
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  removeAttribute(name: string) { this.attributes.delete(name); }
  hasAttribute(name: string) { return this.attributes.has(name); }
  getAttribute(name: string) { return this.attributes.get(name); }
  querySelector(selector: string) { if (!this.children.has(selector)) this.children.set(selector, new ElementDouble(selector)); return this.children.get(selector)!; }
  closest() { return null; }
  focus() { this.focused = true; }
  select() {} scrollIntoView() {} showModal() {} close() {} reportValidity() { return true; }
  add(option: { value: string; textContent: string }) { this.options.push(option); }
  append(item: string | ElementDouble) { this.textContent += typeof item === 'string' ? item : item.textContent; }
}
const boards = [
  { name: '价格榜', file: 'leaderboard', pathname: '/', search: 'search', provider: 'provider', reset: 'reset-filters', share: 'share', panel: 'filter-panel' },
  { name: '性能榜', file: 'performance', pathname: '/performance/', search: 'performance-search', provider: 'performance-provider', reset: 'performance-reset', share: 'share', panel: 'performance-filters' },
  { name: '鹈鹕榜', file: 'pelican', pathname: '/pelican/', search: 'pelican-search', provider: 'pelican-provider', reset: 'pelican-reset', share: 'pelican-share', panel: 'pelican-filters' },
] as const;

function client(board: typeof boards[number], hash = '') {
  const elements = new Map<string, ElementDouble>();
  const element = (id: string) => { if (!elements.has(id)) elements.set(id, new ElementDouble(id)); return elements.get(id)!; };
  element('main').dataset.base = '/';
  const provider = element('provider-openai'); provider.value = 'openai';
  const categories = ['text', 'code', 'vision', 'agent'].map(category => { const button = element(`category-${category}`); button.dataset.performanceCategory = category; return button; });
  const methodLink = element('method-link');
  const doc = new ElementDouble('document');
  const document = Object.assign(doc, {
    activeElement: null as ElementDouble | null,
    getElementById: element,
    createElement: (tag: string) => new ElementDouble(tag),
    querySelectorAll(selector: string) {
      if (selector === `[name="${board.provider}"]`) return [provider];
      if (selector === `[name="${board.provider}"]:checked`) return provider.checked ? [provider] : [];
      if (selector === '[data-performance-category]') return categories;
      if (selector === 'a[href="#performance-method"]') return [methodLink];
      return [];
    },
  });
  const window = new ElementDouble('window');
  const mobile = Object.assign(new ElementDouble('media'), { matches: false });
  const location = { origin: 'https://example.com', pathname: board.pathname, search: '', hash };
  const visits: string[] = [];
  const navigate = (_: unknown, __: unknown, url: string) => { const target = new URL(url, location.origin); location.search = target.search; location.hash = target.hash; visits.push(url); };
  let copied = '', clock = 0, timerId = 0;
  const timers = new Map<number, { at: number; callback: () => void }>();
  const context = vm.createContext({
    ...ranking, ...urlState, ...priceRender, ...performance, ...performanceRender, ...pelican, ...pelicanRender,
    catalog, performanceBoards, performanceCategories, data, document, window, location,
    URL, URLSearchParams, Map, Option: class { constructor(public textContent: string, public value: string) {} },
    history: { replaceState: navigate, pushState: navigate },
    navigator: { clipboard: { async writeText(text: string) { copied = text; } } },
    matchMedia: (query: string) => query.includes('900px') ? mobile : { matches: true },
    captureRows: () => new Map(), animateRows() {},
    setTimeout(callback: () => void, delay: number) { const id = ++timerId; timers.set(id, { at: clock + delay, callback }); return id; },
    clearTimeout(id: number) { timers.delete(id); },
  });
  const source = ['controls', board.file].map(file => readFileSync(new URL(`../src/scripts/${file}.ts`, import.meta.url), 'utf8').replace(/^import .*$/gm, '').replace(/^export /gm, '')).join('\n');
  vm.runInContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  const tick = (ms: number) => { clock += ms; for (const [id, timer] of timers) if (timer.at <= clock) { timers.delete(id); timer.callback(); } };
  const type = async (query: string) => { const input = element(board.search); input.value = query; document.activeElement = input; await input.emit('input'); };
  return { element, provider, categories, methodLink, document, window, mobile, location, visits, tick, type, copied: () => copied };
}

for (const board of boards) {
  test(`${board.name}：快速输入后切厂商不会丢查询，分享和后退保留组合条件`, async () => {
    const app = client(board);
    await app.type('GPT 6');
    app.provider.checked = true;
    app.document.activeElement = app.provider;
    await app.provider.emit('change');
    assert.equal(new URLSearchParams(app.location.search).get('q'), 'GPT 6');
    assert.equal(new URLSearchParams(app.location.search).get('providers'), 'openai');
    assert.equal(app.element(board.search).value, 'GPT 6');
    app.tick(250);
    await app.element(board.share).emit('click');
    assert.equal(new URL(app.copied()).searchParams.get('q'), 'GPT 6');
    assert.equal(new URL(app.copied()).searchParams.get('providers'), 'openai');
    await app.type('pending query');
    app.location.search = '?q=GLM+5.3';
    await app.window.emit('popstate');
    app.tick(250);
    assert.equal(app.element(board.search).value, 'GLM 5.3');
    assert.equal(new URLSearchParams(app.location.search).get('q'), 'GLM 5.3');
  });
  test(`${board.name}：立即分享会提交输入，重置不会被旧定时器恢复`, async () => {
    const app = client(board);
    await app.type('Kimi');
    await app.element(board.share).emit('click');
    assert.equal(new URL(app.copied()).searchParams.get('q'), 'Kimi');
    await app.type('GLM');
    await app.element(board.reset).emit('click');
    app.tick(250);
    assert.equal(app.element(board.search).value, '');
    assert.equal(new URLSearchParams(app.location.search).has('q'), false);
  });
  test(`${board.name}：中文组合输入期间不提交半成品，完成后保留厂商筛选`, async () => {
    const app = client(board);
    const input = app.element(board.search);
    await input.emit('compositionstart');
    await app.type('gu');
    app.provider.checked = true;
    app.document.activeElement = app.provider;
    await app.provider.emit('change');
    app.tick(250);
    assert.equal(new URLSearchParams(app.location.search).has('q'), false);
    assert.equal(input.value, 'gu');
    await app.element(board.share).emit('click');
    assert.equal(new URL(app.copied()).searchParams.has('q'), false);
    input.value = '谷歌';
    await input.emit('compositionend');
    app.tick(250);
    assert.equal(new URLSearchParams(app.location.search).get('q'), '谷歌');
    assert.equal(new URLSearchParams(app.location.search).get('providers'), 'openai');
  });
  test(`${board.name}：跨移动断点同步筛选面板，断点内允许手动展开`, async () => {
    const app = client(board), panel = app.element(board.panel);
    assert.equal(panel.open, true);
    app.mobile.matches = true; await app.mobile.emit('change');
    assert.equal(panel.open, false);
    panel.open = true;
    await app.type('GPT'); app.tick(250);
    assert.equal(panel.open, true);
    panel.open = false;
    app.mobile.matches = false; await app.mobile.emit('change');
    assert.equal(panel.open, true);
  });
}

test('性能分类切换和 Agent 列头排序同时保留刚输入的查询', async () => {
  const app = client(boards[1]);
  await app.type('GPT-6 Astra Max');
  app.document.activeElement = null;
  await app.categories[3].emit('click');
  assert.equal(new URLSearchParams(app.location.search).get('q'), 'GPT-6 Astra Max');
  assert.equal(new URLSearchParams(app.location.search).get('category'), 'agent');
  assert.equal(app.element('performance-count').textContent, '1');
  assert.equal(app.element('performance-sort-label').textContent, '原榜综合名次');
  assert.equal(app.element('performance-score-heading').getAttribute('aria-sort'), 'ascending');
  await app.element('performance-sort-score').emit('click');
  assert.equal(app.element('performance-score-heading').getAttribute('aria-sort'), 'descending');
  assert.equal(new URLSearchParams(app.location.search).get('order'), 'asc');
});

test('性能评分说明可通过普通点击、首次 hash 和后续 hash 直接展开', async () => {
  const initial = client(boards[1], '#performance-method');
  assert.equal(initial.element('performance-method').open, true);
  const app = client(boards[1]), method = app.element('performance-method');
  assert.equal(method.open, false);
  await app.methodLink.emit('click');
  assert.equal(method.open, true);
  assert.equal(method.querySelector('summary').focused, true);
  method.open = false;
  await app.methodLink.emit('click', { metaKey: true });
  assert.equal(method.open, false);
  app.location.hash = '#performance-method'; await app.window.emit('hashchange');
  assert.equal(method.open, true);
});
