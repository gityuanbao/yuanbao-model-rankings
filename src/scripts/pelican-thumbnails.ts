import { previewDocument } from '../lib/pelican-preview';

const sources = new Map<string, string>();

export function mountPelicanThumbnails(root: HTMLElement) {
  let disposed = false;
  const previews = [...root.querySelectorAll<HTMLElement>('[data-pelican-thumbnail]')].map(stage => ({
    stage, frame: stage.querySelector<HTMLIFrameElement>('iframe')!,
    status: stage.querySelector<HTMLElement>('[data-preview-status]')!,
    request: undefined as AbortController | undefined, version: 0, active: false,
  }));
  const fit = (item: typeof previews[number]) => {
    item.frame.style.transform = `scale(${item.stage.clientWidth / 960})`;
  };
  const resize = new ResizeObserver(entries => {
    for (const entry of entries) {
      const item = previews.find(item => item.stage === entry.target);
      if (item) fit(item);
    }
  });
  async function show(item: typeof previews[number]) {
    if (disposed || item.active) return;
    item.active = true;
    const version = ++item.version;
    const current = () => !disposed && item.active && item.version === version;
    item.request = new AbortController();
    item.status.textContent = '正在载入 HTML 作品…';
    item.status.hidden = false;
    item.stage.setAttribute('aria-busy', 'true');
    try {
      const url = item.stage.dataset.source!;
      let html = sources.get(url);
      if (!html) {
        const response = await fetch(url, { signal: item.request.signal });
        if (!response.ok) throw new Error('HTML unavailable');
        html = await response.text();
        if (!html.trim()) throw new Error('HTML empty');
        if (!current()) return;
        sources.set(url, html);
      }
      if (!current()) return;
      const frame = item.frame.cloneNode(false) as HTMLIFrameElement;
      frame.removeAttribute('srcdoc');
      let failed = false;
      frame.addEventListener('load', () => {
        if (!current() || failed) return;
        item.status.hidden = true;
        item.stage.setAttribute('aria-busy', 'false');
      }, { once: true });
      frame.addEventListener('error', () => {
        if (!current()) return;
        failed = true;
        item.status.textContent = '小预览暂时无法显示，可点击放大或下载 HTML。';
        item.status.hidden = false;
        item.stage.setAttribute('aria-busy', 'false');
      }, { once: true });
      frame.srcdoc = previewDocument(html);
      item.frame.replaceWith(frame);
      item.frame = frame;
      fit(item);
    } catch {
      if (!current()) return;
      item.status.textContent = '小预览暂时无法载入，可点击放大或下载 HTML。';
      item.stage.setAttribute('aria-busy', 'false');
    }
  }
  function hide(item: typeof previews[number]) {
    item.active = false;
    item.version++;
    item.request?.abort();
    item.frame.srcdoc = '';
    item.stage.setAttribute('aria-busy', 'false');
  }
  const visibility = new IntersectionObserver(entries => {
    for (const entry of entries) {
      const item = previews.find(item => item.stage === entry.target);
      if (item) { if (entry.isIntersecting) void show(item); else hide(item); }
    }
  }, { rootMargin: '160px 0px' });
  for (const item of previews) { fit(item); resize.observe(item.stage); visibility.observe(item.stage); }
  return () => { disposed = true; visibility.disconnect(); resize.disconnect(); previews.forEach(hide); };
}
