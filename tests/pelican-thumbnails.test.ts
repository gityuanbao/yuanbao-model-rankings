import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { previewDocument } from '../src/lib/pelican-preview';

function harness() {
  class Frame {
    srcdoc = ''; style: Record<string, string> = {};
    listeners: Record<string, () => void> = {};
    cloneNode() { return new Frame(); }
    removeAttribute() {}
    addEventListener(event: string, callback: () => void) { this.listeners[event] = callback; }
    replaceWith(next: Frame) { frame = next; }
  }
  let frame = new Frame();
  const status = { hidden: false, textContent: '' };
  const stage = {
    dataset: { source: '/original.html.txt' }, clientWidth: 320,
    attributes: new Map<string, string>(),
    querySelector(selector: string) { return selector === 'iframe' ? frame : status; },
    setAttribute(name: string, value: string) { this.attributes.set(name, value); },
  };
  let intersection: (entries: unknown[]) => void = () => {};
  let disconnected = false;
  const requests: Array<{ signal: AbortSignal; resolve: (value: unknown) => void; reject: (reason: unknown) => void }> = [];
  const source = readFileSync(new URL('../src/scripts/pelican-thumbnails.ts', import.meta.url), 'utf8').replace(/^import .*$/gm, '').replace(/^export /gm, '');
  const context = vm.createContext({
    previewDocument, AbortController,
    root: { querySelectorAll: () => [stage] },
    fetch: (_url: string, options: { signal: AbortSignal }) => new Promise((resolve, reject) => requests.push({ signal: options.signal, resolve, reject })),
    ResizeObserver: class { observe() {} disconnect() {} },
    IntersectionObserver: class {
      constructor(callback: typeof intersection) { intersection = callback; }
      observe() {} disconnect() { disconnected = true; }
    },
  });
  vm.runInContext(ts.transpileModule(source + '\nvar dispose = mountPelicanThumbnails(root);', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  const flush = () => new Promise<void>(resolve => setImmediate(resolve));
  const visible = (value: boolean) => intersection([{ target: stage, isIntersecting: value }]);
  const respond = async (index: number, html: string, ok = true) => { requests[index].resolve({ ok, text: async () => html }); await flush(); };
  return { frame: () => frame, status, stage, requests, visible, respond, flush, dispose: () => vm.runInContext('dispose()', context), disconnected: () => disconnected };
}

test('HTML thumbnails load near the viewport, scale consistently, release offscreen code and reuse source text', async () => {
  const app = harness();
  assert.equal(app.requests.length, 0);
  app.visible(true); await app.respond(0, '<svg id="original"></svg>');
  const original = app.frame();
  assert.match(original.srcdoc, /Content-Security-Policy/);
  assert.match(original.srcdoc, /id="original"/);
  assert.equal(original.style.transform, `scale(${320 / 960})`);
  original.listeners.load(); assert.equal(app.status.hidden, true);
  app.visible(false); assert.equal(original.srcdoc, '');
  app.visible(true); assert.equal(app.requests.length, 1, 'returning to viewport should reuse cached source');
  assert.match(app.frame().srcdoc, /id="original"/);
  app.dispose(); assert.equal(app.frame().srcdoc, ''); assert.equal(app.disconnected(), true);
});

test('filter disposal aborts pending fetches and late responses cannot restart removed previews', async () => {
  const app = harness();
  app.visible(true); app.dispose();
  assert.equal(app.requests[0].signal.aborted, true);
  await app.respond(0, '<svg id="stale"></svg>');
  assert.equal(app.frame().srcdoc, '');
});

test('HTML load failures remain readable and retry when the preview comes back into view', async () => {
  for (const failure of ['http', 'empty', 'network']) {
    const app = harness(); app.visible(true);
    if (failure === 'network') { app.requests[0].reject(new Error('offline')); await app.flush(); }
    else await app.respond(0, failure === 'empty' ? ' ' : 'missing', failure !== 'http');
    assert.match(app.status.textContent, /暂时无法载入/);
    assert.equal(app.status.hidden, false);
    app.visible(false); app.visible(true); await app.respond(1, '<svg></svg>');
    app.frame().listeners.load(); assert.equal(app.status.hidden, true);
  }
});

test('an old frame load cannot hide the current preview error after scrolling away and back', async () => {
  const app = harness(); app.visible(true); await app.respond(0, '<svg></svg>');
  const old = app.frame(); app.visible(false); app.visible(true);
  app.frame().listeners.error(); old.listeners.load();
  assert.match(app.status.textContent, /暂时无法显示/);
  assert.equal(app.status.hidden, false);
  app.frame().listeners.load(); assert.equal(app.status.hidden, false);
});
