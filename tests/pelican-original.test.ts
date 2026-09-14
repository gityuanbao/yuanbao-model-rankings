import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { parseFragment, type DefaultTreeAdapterMap } from 'parse5';
import { pathFor } from '../src/lib/render';

class ElementDouble {
  dataset: Record<string, string> = {};
  style: Record<string, string> = {};
  attributes = new Map<string, string>();
  listeners = new Map<string, Array<{ callback: (event: any) => unknown; once: boolean }>>();
  textContent = ''; href = ''; download = ''; srcdoc = ''; open = false; disabled = false;
  clientWidth = 480;
  replacement: ElementDouble | undefined;
  constructor(public id: string, private replace?: (element: ElementDouble) => void) {}
  addEventListener(type: string, callback: (event: any) => unknown, options?: { once?: boolean }) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), { callback, once: options?.once ?? false }]);
  }
  async emit(type: string, patch: Record<string, unknown> = {}) {
    const listeners = this.listeners.get(type) ?? [];
    this.listeners.set(type, listeners.filter(listener => !listener.once));
    for (const listener of listeners) await listener.callback({ target: this, ...patch });
  }
  closest(selector: string) { return selector === '[data-pelican-original]' && this.dataset.pelicanOriginal ? this : null; }
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  removeAttribute(name: string) { this.attributes.delete(name); if (name === 'srcdoc') this.srcdoc = ''; }
  cloneNode() {
    const copy = new ElementDouble(this.id, this.replace);
    copy.attributes = new Map(this.attributes); copy.style = { ...this.style }; copy.srcdoc = this.srcdoc;
    return copy;
  }
  replaceWith(next: ElementDouble) { this.replacement = next; this.replace?.(next); }
  showModal() { assert.equal(this.open, false, 'already-open modal must not be reopened'); this.open = true; }
  close() { this.open = false; void this.emit('close'); }
}

function harness() {
  const elements = new Map<string, ElementDouble>();
  const element = (id: string) => {
    if (!elements.has(id)) elements.set(id, new ElementDouble(id, replacement => elements.set(id, replacement)));
    return elements.get(id)!;
  };
  element('main').dataset.base = '/rankings/';
  element('pelican-original-frame').attributes.set('sandbox', 'allow-scripts');
  const document = Object.assign(new ElementDouble('document'), { getElementById: element });
  const requests: Array<{ url: string; signal: AbortSignal; resolve: (response: unknown) => void; reject: (error: unknown) => void }> = [];
  const entries = ['first', 'second'].map(id => ({
    id, name: `作品 ${id}`, ruleVersion: '3.0', artifact: { src: `pelican-originals/${id}.html.txt`, download: `pelican-originals/${id}.zip` },
  }));
  const source = readFileSync(new URL('../src/scripts/pelican-original.ts', import.meta.url), 'utf8').replace(/^import .*$/gm, '');
  const context = vm.createContext({
    data: { entries }, pelicanSchema: { parse: (value: unknown) => value },
    isPelicanV3Entry: (entry: typeof entries[number]) => entry.ruleVersion === '3.0', pathFor,
    document, AbortController,
    ResizeObserver: class { constructor(_callback: () => void) {} observe() {} },
    fetch: (url: string, options: { signal: AbortSignal }) => new Promise((resolve, reject) => requests.push({ url, signal: options.signal, resolve, reject })),
  });
  vm.runInContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  const open = (id: string) => {
    const button = new ElementDouble('opener'); button.dataset.pelicanOriginal = id;
    return document.emit('click', { target: button });
  };
  const respond = (index: number, html: string, ok = true) => requests[index].resolve({ ok, text: async () => html });
  return { element, document, requests, open, respond };
}

test('original viewer maintains an opaque sandbox, denies sensitive capabilities and starts with replay disabled', () => {
  const component = readFileSync(new URL('../src/components/PelicanOriginal.astro', import.meta.url), 'utf8');
  const descendants = (node: DefaultTreeAdapterMap['parentNode']): DefaultTreeAdapterMap['element'][] => node.childNodes.flatMap(child => 'tagName' in child ? [child, ...descendants(child)] : []);
  const nodes = descendants(parseFragment(component));
  const iframe = nodes.find(node => node.tagName === 'iframe')!;
  const attrs = Object.fromEntries(iframe.attrs.map(attr => [attr.name, attr.value]));
  assert.equal(attrs.sandbox, 'allow-scripts');
  assert.equal(attrs.referrerpolicy, 'no-referrer');
  assert.equal(attrs.src, undefined);
  for (const capability of ['camera', 'microphone', 'geolocation']) assert.ok(attrs.allow.includes(`${capability} 'none'`));
  const replay = nodes.find(node => node.attrs.some(attr => attr.name === 'id' && attr.value === 'pelican-original-reload'))!;
  assert.ok(replay.attrs.some(attr => attr.name === 'disabled'));
});

test('CSP precedes all submitted markup, download URLs remain raw, and readiness waits for the current iframe load', async () => {
  const app = harness();
  const raw = '<!doctype html><html lang="zh"><head><title>原作</title></head><body>\r\n<svg viewBox="0 0 10 10"></svg><script>window.ready = true;</script></body></html>';
  const opening = app.open('first');
  assert.equal(app.element('pelican-original-reload').disabled, true);
  assert.equal(app.element('pelican-original-status').textContent, '正在打开作品…');
  assert.equal(app.requests[0].url, '/rankings/pelican-originals/first.html.txt');
  app.respond(0, raw); await opening;
  const frame = app.element('pelican-original-frame');
  assert.match(frame.srcdoc, /^<!doctype html><meta http-equiv="Content-Security-Policy"/);
  assert.ok(frame.srcdoc.endsWith(raw), 'preview policy must not rewrite the submitted HTML body');
  for (const directive of ["default-src 'none'", "connect-src 'none'", "form-action 'none'", "frame-src 'none'", "base-uri 'none'"]) assert.ok(frame.srcdoc.slice(0, -raw.length).includes(directive));
  assert.equal(frame.attributes.get('sandbox'), 'allow-scripts');
  assert.equal(app.element('pelican-original-download').href, '/rankings/pelican-originals/first.html.txt');
  assert.equal(app.element('pelican-original-download').download, 'first.html');
  assert.equal(app.element('pelican-original-package').href, '/rankings/pelican-originals/first.zip');
  assert.equal(app.element('pelican-original-status').textContent, '正在显示作品…');
  assert.equal(app.element('pelican-original-stage').attributes.get('aria-busy'), 'true');
  assert.equal(frame.style.transform, 'scale(0.5)');
  await frame.emit('load');
  assert.match(app.element('pelican-original-status').textContent, /960 × 720 原作预览/);
  assert.equal(app.element('pelican-original-reload').disabled, false);
  assert.equal(app.element('pelican-original-stage').attributes.get('aria-busy'), 'false');
});

test('rapid switching aborts the previous request and late responses or iframe events cannot replace the new work', async () => {
  const app = harness();
  const first = app.open('first');
  const second = app.open('second');
  assert.equal(app.requests[0].signal.aborted, true);
  app.respond(1, '<svg id="second"></svg>'); await second;
  app.respond(0, '<svg id="first"></svg>'); await first;
  assert.match(app.element('pelican-original-frame').srcdoc, /id="second"/);
  assert.doesNotMatch(app.element('pelican-original-frame').srcdoc, /id="first"/);
  const staleFrame = app.element('pelican-original-frame');
  const next = app.open('first');
  await staleFrame.emit('load');
  assert.equal(app.element('pelican-original-status').textContent, '正在打开作品…');
  app.respond(2, '<svg id="latest"></svg>'); await next;
  assert.equal(app.element('pelican-original-title').textContent, '作品 first · HTML 作品');
  assert.match(app.element('pelican-original-frame').srcdoc, /id="latest"/);
});

test('HTTP, network and empty-source failures remain readable and leave source downloads available', async () => {
  for (const mode of ['http', 'network', 'empty']) {
    const app = harness();
    const opening = app.open('first');
    if (mode === 'network') app.requests[0].reject(new Error('offline'));
    else app.respond(0, mode === 'empty' ? ' \r\n ' : 'missing', mode !== 'http');
    await opening;
    assert.match(app.element('pelican-original-status').textContent, /作品暂时无法载入/);
    assert.equal(app.element('pelican-original-reload').disabled, true);
    assert.equal(app.element('pelican-original-stage').attributes.get('aria-busy'), 'false');
    assert.equal(app.element('pelican-original-frame').srcdoc, '');
    assert.equal(app.element('pelican-original-download').href, '/rankings/pelican-originals/first.html.txt');
  }
});

test('closing invalidates pending loads and replay replaces its iframe without fetching or changing downloads', async () => {
  const app = harness();
  const opening = app.open('first');
  app.respond(0, '<svg id="original"></svg>'); await opening;
  const original = app.element('pelican-original-frame'); await original.emit('load');
  const download = app.element('pelican-original-download').href;
  await app.element('pelican-original-reload').emit('click');
  const replay = app.element('pelican-original-frame');
  assert.notEqual(replay, original);
  assert.equal(app.requests.length, 1);
  assert.equal(replay.srcdoc, original.srcdoc);
  assert.equal(app.element('pelican-original-download').href, download);
  await app.element('pelican-original-close').emit('click');
  assert.equal(app.element('pelican-original-dialog').open, false);
  assert.equal(app.requests[0].signal.aborted, true);
  assert.equal(replay.srcdoc, '');
  await replay.emit('load');
  assert.equal(app.element('pelican-original-reload').disabled, true);
  assert.equal(app.element('pelican-original-stage').attributes.get('aria-busy'), 'false');
  await app.element('pelican-original-reload').emit('click');
  assert.equal(app.element('pelican-original-frame'), replay);

  const pending = app.open('second');
  await app.element('pelican-original-close').emit('click');
  app.respond(1, '<svg id="must-not-return"></svg>'); await pending;
  assert.equal(app.element('pelican-original-frame').srcdoc, '');
});

test('an iframe error clears the loading indicator and replay starts a fresh preview without accepting stale events', async () => {
  const app = harness();
  const opening = app.open('first');
  app.respond(0, '<svg></svg>'); await opening;
  const failed = app.element('pelican-original-frame');
  await failed.emit('error');
  assert.match(app.element('pelican-original-status').textContent, /预览暂时无法显示/);
  assert.equal(app.element('pelican-original-reload').disabled, false);
  assert.equal(app.element('pelican-original-stage').attributes.get('aria-busy'), 'false');
  await failed.emit('load');
  assert.match(app.element('pelican-original-status').textContent, /预览暂时无法显示/, 'a late load must not erase the current preview error');
  await app.element('pelican-original-reload').emit('click');
  await failed.emit('load');
  assert.equal(app.element('pelican-original-status').textContent, '正在显示作品…');
  assert.equal(app.element('pelican-original-reload').disabled, true);
  await app.element('pelican-original-frame').emit('load');
  assert.match(app.element('pelican-original-status').textContent, /960 × 720 原作预览/);
});
