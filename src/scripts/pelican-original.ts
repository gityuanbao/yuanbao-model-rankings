import data from '../data/pelican.json';
import { isPelicanV3Entry, pelicanSchema } from '../lib/pelican';
import { pathFor } from '../lib/render';

const board = pelicanSchema.parse(data);
const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const dialog = byId<HTMLDialogElement>('pelican-original-dialog');
let frame = byId<HTMLIFrameElement>('pelican-original-frame');
const stage = byId('pelican-original-stage');
const status = byId('pelican-original-status');
const reload = byId<HTMLButtonElement>('pelican-original-reload');
const base = byId('main').dataset.base!;
let request: AbortController | undefined;
let source = '';
let previewVersion = 0;

// Keep downloads untouched. The preview's opaque sandbox isolates the parent
// page; CSP blocks external resources and forms in these reviewed submissions.
function previewDocument(html: string) {
  const policy = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; object-src 'none'";
  // Install CSP before parsing any original markup. DOMParser can request image
  // and iframe resources before a policy is subsequently inserted into its head.
  return `<!doctype html><meta http-equiv="Content-Security-Policy" content="${policy}">${html}`;
}

function fit() {
  const scale = Math.min(1, stage.clientWidth / 960);
  frame.style.transform = `scale(${scale})`;
  stage.style.height = `${720 * scale}px`;
}
new ResizeObserver(fit).observe(stage);
function play() {
  if (!source || !dialog.open) return;
  const version = ++previewVersion;
  const next = frame.cloneNode(false) as HTMLIFrameElement;
  next.removeAttribute('src');
  next.removeAttribute('srcdoc');
  status.textContent = '正在显示作品…';
  stage.setAttribute('aria-busy', 'true');
  reload.disabled = true;
  let settled = false;
  const currentPreview = () => !settled && version === previewVersion && frame === next && dialog.open;
  next.addEventListener('load', () => {
    if (!currentPreview()) return;
    settled = true;
    status.textContent = '960 × 720 原作预览 · 可操作作品中的按钮';
    stage.setAttribute('aria-busy', 'false');
    reload.disabled = false;
  }, { once: true });
  next.addEventListener('error', () => {
    if (!currentPreview()) return;
    settled = true;
    status.textContent = '预览暂时无法显示，可下载 HTML 或重新播放。';
    stage.setAttribute('aria-busy', 'false');
    reload.disabled = false;
  }, { once: true });
  next.srcdoc = previewDocument(source);
  frame.replaceWith(next);
  frame = next;
  fit();
}

document.addEventListener('click', async event => {
  const button = (event.target as Element | null)?.closest<HTMLButtonElement>('[data-pelican-original]');
  if (!button) return;
  const entry = board.entries.find(entry => entry.id === button.dataset.pelicanOriginal);
  if (!entry || !isPelicanV3Entry(entry) || !entry.artifact) return;
  request?.abort();
  const current = request = new AbortController();
  previewVersion++;
  source = ''; frame.srcdoc = '';
  reload.disabled = true;
  stage.setAttribute('aria-busy', 'true');
  byId('pelican-original-title').textContent = `${entry.name} · HTML 作品`;
  const download = byId<HTMLAnchorElement>('pelican-original-download');
  download.href = pathFor(base, entry.artifact.src);
  download.download = `${entry.id}.html`;
  byId<HTMLAnchorElement>('pelican-original-package').href = pathFor(base, entry.artifact.download);
  status.textContent = '正在打开作品…';
  if (!dialog.open) dialog.showModal();
  fit();
  try {
    const response = await fetch(pathFor(base, entry.artifact.src), { signal: current.signal });
    if (!response.ok) throw new Error('HTML unavailable');
    const html = await response.text();
    if (request !== current || !dialog.open) return;
    if (!html.trim()) throw new Error('HTML is empty');
    source = html;
    play();
  } catch {
    if (request === current && !current.signal.aborted && dialog.open) {
      status.textContent = '作品暂时无法载入，可下载 HTML 或稍后重试。';
      stage.setAttribute('aria-busy', 'false');
    }
  }
});
byId('pelican-original-close').addEventListener('click', () => dialog.close());
reload.addEventListener('click', play);
dialog.addEventListener('close', () => {
  request?.abort(); request = undefined;
  previewVersion++;
  source = ''; frame.srcdoc = '';
  reload.disabled = true;
  stage.setAttribute('aria-busy', 'false');
});
