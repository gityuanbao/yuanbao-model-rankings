import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { parseFragment, type DefaultTreeAdapterMap } from 'parse5';
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
import * as pelicanShowcase from '../src/lib/pelican-showcase';

// Execute the real clients with deterministic DOM/event/timer doubles. This covers
// the input -> filter -> history/share integration, not just query serialization.
class ElementDouble {
  value = ''; textContent = ''; hidden = false; checked = false; open = false; disabled = false; title = '';
  private html = ''; private renderedChildren: ElementDouble[] | null = null;
  parentElement: ElementDouble | null = null;
  dataset: Record<string, string> = {}; attributes = new Map<string, string>();
  listeners = new Map<string, ((event: any) => unknown)[]>();
  children = new Map<string, ElementDouble>(); options = [{ value: '0', textContent: '' }, { value: 'asc', textContent: '' }];
  classList = {
    toggle: (name: string, force?: boolean) => {
      const classes = new Set((this.attributes.get('class') ?? '').split(/\s+/).filter(Boolean));
      const active = force ?? !classes.has(name);
      if (active) classes.add(name); else classes.delete(name);
      this.attributes.set('class', [...classes].join(' '));
      return active;
    },
    contains: (name: string) => (this.attributes.get('class') ?? '').split(/\s+/).includes(name),
  }; focused = false;
  constructor(public id: string) {}
  get innerHTML() { return this.html; }
  set innerHTML(value: string) { this.html = value; this.renderedChildren = null; }
  addEventListener(type: string, callback: (event: any) => unknown) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), callback]); }
  async emit(type: string, patch: Record<string, unknown> = {}) {
    const event = { button: 0, target: this, preventDefault() {}, ...patch };
    for (const listener of this.listeners.get(type) ?? []) await listener(event);
  }
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  removeAttribute(name: string) { this.attributes.delete(name); }
  hasAttribute(name: string) { return this.attributes.has(name); }
  getAttribute(name: string) { return this.attributes.get(name); }
  private matchesSelector(selector: string) {
    const match = selector.match(/^(?:\.([\w-]+))?(?:\[([\w-]+)(?:="([^"]*)")?\])?$/);
    if (!match) return false;
    if (match[1] && !(this.attributes.get('class') ?? '').split(/\s+/).includes(match[1])) return false;
    if (match[2] === 'open') return this.open;
    if (match[2] && !this.hasAttribute(match[2])) return false;
    return match[3] === undefined || this.getAttribute(match[2]) === match[3];
  }
  private rendered() {
    if (this.renderedChildren === null) {
      const convert = (node: DefaultTreeAdapterMap['childNode'], parent: ElementDouble): ElementDouble[] => {
        if (!('tagName' in node)) return [];
        const child = node.tagName === 'video' ? new VideoElementDouble(node.tagName) : new ElementDouble(node.tagName);
        child.parentElement = parent;
        for (const { name, value } of node.attrs) {
          child.attributes.set(name, value);
          if (name.startsWith('data-')) child.dataset[name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
          if (name === 'id') child.id = value;
        }
        child.hidden = child.hasAttribute('hidden'); child.open = child.hasAttribute('open');
        child.renderedChildren = node.childNodes.flatMap(node => convert(node, child));
        return [child];
      };
      this.renderedChildren = parseFragment(this.html).childNodes.flatMap(node => convert(node, this));
    }
    return this.renderedChildren;
  }
  querySelectorAll(selector: string): ElementDouble[] {
    return this.rendered().flatMap(child => [...(child.matchesSelector(selector) ? [child] : []), ...child.querySelectorAll(selector)]);
  }
  querySelector(selector: string) {
    const rendered = this.querySelectorAll(selector)[0];
    if (rendered) return rendered;
    if (!this.children.has(selector)) this.children.set(selector, new ElementDouble(selector));
    return this.children.get(selector)!;
  }
  closest(selector: string): ElementDouble | null { return this.matchesSelector(selector) ? this : this.parentElement?.closest(selector) ?? null; }
  focus() { this.focused = true; }
  select() {} scrollIntoView() {} showModal() {} close() {} reportValidity() { return true; }
  add(option: { value: string; textContent: string }) { this.options.push(option); }
  append(item: string | ElementDouble) { this.textContent += typeof item === 'string' ? item : item.textContent; }
}
class VideoElementDouble extends ElementDouble {}
const boards = [
  { name: '价格榜', file: 'leaderboard', pathname: '/', search: 'search', provider: 'provider', reset: 'reset-filters', share: 'share', panel: 'filter-panel' },
  { name: '性能榜', file: 'performance', pathname: '/performance/', search: 'performance-search', provider: 'performance-provider', reset: 'performance-reset', share: 'share', panel: 'performance-filters' },
  { name: '鹈鹕榜', file: 'pelican', pathname: '/pelican/', search: 'pelican-search', provider: 'pelican-provider', reset: 'pelican-reset', share: 'pelican-share', panel: 'pelican-filters' },
] as const;

function pelicanFixture(id: string, providerId: pelican.PelicanV3Entry['providerId'], status: 'provisional' | 'scored' = 'provisional', total = 100): pelican.PelicanV3Entry {
  let remaining = total;
  const criteria = pelican.pelicanCriteria.map(criterion => {
    const score = status === 'provisional' && criterion.kind === 'technical' ? null : Math.min(remaining, criterion.maximum);
    if (score !== null) remaining -= score;
    return { id: criterion.id, score, reason: '测试夹具的对应观察依据', evidenceTimes: criterion.kind === 'visual' ? [0] : [] };
  });
  return pelican.pelicanV3EntrySchema.parse({
    id, name: `${providerId === 'openai' ? 'GPT' : 'Kimi'} ${id}`, providerId, ruleVersion: '3.0',
    media: { type: 'video', src: `media/pelican/${id}.mp4`, poster: `media/pelican/${id}.webp`, width: 1280, height: 960 },
    ...(status === 'scored' ? { artifact: { src: `pelican-originals/${id}.html.txt`, download: `pelican-originals/${id}.zip`, sha256: 'a'.repeat(64), htmlVerifiedAt: '2026-09-14', svgVerified: true, runStatus: 'passed' } } : {}),
    test: { modelLabel: `原始型号 ${id}`, platform: null, effort: null, date: null, tools: 'unknown', codeModified: null, identityStatus: 'submitted' },
    assessment: { status, reviewedAt: '2026-09-14', reviewer: 'AI', ownerConfirmed: false, criteria },
  });
}
const fixtureBoard = (entries: pelican.PelicanV3Entry[]) => pelican.pelicanSchema.parse({ schemaVersion: 2, ruleVersion: '3.0', entries });

function client(board: typeof boards[number], hash = '', pelicanData: unknown = data) {
  const elements = new Map<string, ElementDouble>();
  const element = (id: string) => { if (!elements.has(id)) elements.set(id, new ElementDouble(id)); return elements.get(id)!; };
  element('main').dataset.base = '/';
  element('pelican-showcase-data').textContent = JSON.stringify(pelicanShowcase.getPelicanShowcaseEntries(pelican.pelicanSchema.parse(pelicanData)));
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
    ...ranking, ...urlState, ...priceRender, ...performance, ...performanceRender, ...pelican, ...pelicanRender, ...pelicanShowcase,
    mountPelicanThumbnails: () => () => {},
    catalog, performanceBoards, performanceCategories, data: pelicanData, document, window, location,
    URL, URLSearchParams, Map, HTMLVideoElement: VideoElementDouble, Option: class { constructor(public textContent: string, public value: string) {} },
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

test('大模型科目三：筛选更新作品且不显示测试记录，空结果可恢复', async () => {
  const fixture = fixtureBoard([pelicanFixture('openai-pending', 'openai'), pelicanFixture('moonshot-pending', 'moonshot')]);
  const app = client(boards[2], '', fixture);
  const works = app.element('pelican-works');
  const ids = () => works.querySelectorAll('[data-model-id]').map(row => row.dataset.modelId);
  assert.deepEqual(ids(), ['openai-pending', 'moonshot-pending']);
  assert.doesNotMatch(works.innerHTML, /测试记录|pelican-test-record/);
  app.provider.checked = true;
  await app.provider.emit('change');
  assert.deepEqual(ids(), ['openai-pending']);
  assert.match(app.element('pelican-summary').textContent, /暂不评分和排名/);
  await app.type('no matching model'); app.tick(250);
  assert.deepEqual(ids(), []);
  assert.equal(app.element('pelican-empty').hidden, false);
  assert.equal(app.element('pelican-list').hidden, true);
  await app.element('pelican-empty-reset').emit('click');
  assert.deepEqual(ids(), ['openai-pending', 'moonshot-pending']);
  assert.equal(app.element('pelican-empty').hidden, true);
});

test('鹈鹕作品展示：原有分数和旧排序链接不影响提交顺序，筛选与分享正确恢复', async () => {
  const mixed = fixtureBoard([
    pelicanFixture('pending', 'moonshot'), pelicanFixture('runner-up', 'openai', 'scored', 90),
    pelicanFixture('winner', 'openai', 'scored'), pelicanFixture('third', 'moonshot', 'scored', 75),
  ]);
  const app = client(boards[2], '#pelican-method', mixed);
  const ids = () => app.element('pelican-works').querySelectorAll('[data-model-id]').map(row => row.dataset.modelId);
  assert.deepEqual(ids(), ['pending', 'runner-up', 'winner', 'third']);
  assert.doesNotMatch(app.element('pelican-works').innerHTML, /<video|pelican-score|tier-hang|第一名|观察分/);
  app.location.search = '?order=asc'; await app.window.emit('popstate');
  assert.deepEqual(ids(), ['pending', 'runner-up', 'winner', 'third']);
  await app.type('GPT'); app.provider.checked = true;
  app.document.activeElement = app.provider; await app.provider.emit('change'); app.tick(250);
  assert.deepEqual(ids(), ['runner-up', 'winner']);
  await app.element('pelican-share').emit('click');
  const shared = new URL(app.copied());
  assert.equal(shared.searchParams.has('order'), false);
  assert.equal(shared.searchParams.get('q'), 'GPT');
  assert.equal(shared.searchParams.get('providers'), 'openai');
  assert.equal(shared.hash, '#pelican-method');
  await app.element('pelican-reset').emit('click');
  assert.deepEqual(ids(), ['pending', 'runner-up', 'winner', 'third']);
  app.location.search = shared.search; await app.window.emit('popstate');
  assert.deepEqual(ids(), ['runner-up', 'winner']);
  assert.equal(app.provider.checked, true);
  assert.equal(app.element('pelican-search').value, 'GPT');
});
