import type { Catalog } from './schema';
import type { PelicanBoard, PelicanFilters } from './pelican';
import { modelSearch } from './search';
import { escapeHtml as e, mark, pathFor } from './render';

// Only this projection is sent to the showcase page. Historic scores and GIF
// references remain in the intake archive, outside the browser's page data.
export function getPelicanShowcaseEntries(board: PelicanBoard) {
  return board.entries.flatMap(entry => 'ruleVersion' in entry ? [{
    id: entry.id, name: entry.name, providerId: entry.providerId,
    artifact: entry.artifact ? { src: entry.artifact.src, download: entry.artifact.download } : null,
    note: entry.showcaseNote ?? null,
    test: {
      platform: entry.test.platform, effort: entry.test.effort, date: entry.test.date,
      promptStatus: entry.test.promptStatus, promptText: entry.test.promptText,
    },
  }] : []);
}
export type PelicanShowcaseEntry = ReturnType<typeof getPelicanShowcaseEntries>[number];

export function getPelicanShowcaseRows(entries: PelicanShowcaseEntry[], catalog: Catalog, filters: PelicanFilters) {
  const matches = modelSearch(filters.query);
  return entries.filter(entry => {
    const provider = catalog.providers.find(item => item.id === entry.providerId)!;
    return (!filters.providers.length || filters.providers.includes(entry.providerId)) && matches(entry.name, provider.name, provider.shortName, entry.providerId);
  });
}

export function renderPelicanShowcase(rows: PelicanShowcaseEntry[], catalog: Catalog, base: string) {
  return `<ul class="pelican-entries pelican-showcase" aria-label="模型作品，按提交顺序展示">${rows.map(entry => {
    const provider = catalog.providers.find(item => item.id === entry.providerId)!;
    const artwork = entry.artifact ? `<figure class="pelican-html-artwork">
      <div class="pelican-thumbnail" data-pelican-thumbnail="${e(entry.id)}" data-source="${e(pathFor(base, entry.artifact.src))}" aria-busy="true">
        <iframe title="${e(entry.name)} 的 HTML 小预览" sandbox="allow-scripts" referrerpolicy="no-referrer" allow="camera 'none'; microphone 'none'; geolocation 'none'; fullscreen 'none'" width="960" height="720" tabindex="-1" aria-hidden="true"></iframe>
        <span class="pelican-thumbnail-status" data-preview-status>正在载入 HTML 作品…</span>
        <button class="pelican-thumbnail-open" type="button" data-pelican-original="${e(entry.id)}" aria-label="放大查看 ${e(entry.name)} 的 HTML 作品"><span>放大查看 ↗</span></button>
      </div>
      <figcaption><button class="pelican-original-button" type="button" data-pelican-original="${e(entry.id)}" aria-label="查看 ${e(entry.name)} 的 HTML 作品">查看 HTML 作品</button><a href="${e(pathFor(base, entry.artifact.src))}" download="${e(entry.id)}.html">下载 HTML ↓</a></figcaption>
    </figure>` : '<div class="pelican-html-missing">HTML 原作待补充</div>';
    return `<li class="pelican-showcase-entry" id="pelican-entry-${e(entry.id)}" data-model-id="${e(entry.id)}">
      <div class="pelican-work-info"><div class="pelican-model">${mark(catalog, entry.providerId, base)}<div><h3>${e(entry.name)}</h3><span>${e(provider.shortName)}</span></div></div>
      ${entry.note ? `<p class="pelican-material-note">${e(entry.note)}</p>` : ''}
      <details class="pelican-test-record"><summary>测试记录</summary><dl class="pelican-test-info">
        <div><dt>测试平台</dt><dd>${e(entry.test.platform ?? '待补充')}</dd></div>
        <div><dt>实际档位</dt><dd>${e(entry.test.effort ?? '待补充')}</dd></div>
        <div><dt>测试日期</dt><dd>${e(entry.test.date ?? '待补充')}</dd></div>
        <div><dt>型号记录</dt><dd>按回传表收录</dd></div>
      </dl>${entry.test.promptStatus === 'variant' ? `<p class="pelican-material-note">提示词措辞有差异：${e(entry.test.promptText ?? '')}</p>` : ''}</details></div>${artwork}</li>`;
  }).join('')}</ul>`;
}
