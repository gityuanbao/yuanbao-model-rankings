import type { Catalog } from './schema';
import type { PelicanBoard, PelicanFilters } from './pelican';
import type { PelicanHtmlEntry } from './pelican-html';
import { modelSearch } from './search';
import { escapeHtml as e, mark, pathFor } from './render';
import { getManualTotal, pelicanManualBoard, pelicanManualCriteria } from './pelican-manual';

// Only this projection is sent to the showcase page. Historic scores and GIF
// references remain in the intake archive, outside the browser's page data.
export function getPelicanShowcaseEntries(board: PelicanBoard, manual = pelicanManualBoard, additional: PelicanHtmlEntry[] = []) {
  const marks = new Map(manual.entries.map(entry => [entry.id, entry]));
  const sourceEntries = [...board.entries.filter(entry => 'ruleVersion' in entry), ...additional];
  if (new Set(sourceEntries.map(entry => entry.id)).size !== sourceEntries.length) throw new Error('作品 ID 不能跨批次重复');
  return sourceEntries.map(entry => ({
    id: entry.id, name: entry.name, providerId: entry.providerId,
    artifact: entry.artifact ? { src: entry.artifact.src, download: entry.artifact.download } : null,
    note: 'showcaseNote' in entry ? entry.showcaseNote ?? null : null,
    manual: marks.has(entry.id) ? { scores: marks.get(entry.id)!.scores, total: getManualTotal(marks.get(entry.id)!.scores) } : null,
  }));
}
export type PelicanShowcaseEntry = ReturnType<typeof getPelicanShowcaseEntries>[number];

export function getPelicanShowcaseRows(entries: PelicanShowcaseEntry[], catalog: Catalog, filters: PelicanFilters) {
  const matches = modelSearch(filters.query);
  return entries.filter(entry => {
    const provider = catalog.providers.find(item => item.id === entry.providerId)!;
    return (!filters.providers.length || filters.providers.includes(entry.providerId)) && matches(entry.name, provider.name, provider.shortName, entry.providerId);
  }).sort((a, b) => {
    if (!a.manual) return b.manual ? 1 : 0;
    if (!b.manual) return -1;
    return b.manual.total - a.manual.total;
  });
}

export function renderPelicanShowcase(rows: PelicanShowcaseEntry[], catalog: Catalog, base: string) {
  const scored = rows.filter(entry => entry.manual);
  const pending = rows.filter(entry => !entry.manual);
  const renderEntry = (entry: PelicanShowcaseEntry) => {
    const provider = catalog.providers.find(item => item.id === entry.providerId)!;
    const artwork = entry.artifact ? `<figure class="pelican-html-artwork">
      <div class="pelican-thumbnail" data-pelican-thumbnail="${e(entry.id)}" data-source="${e(pathFor(base, entry.artifact.src))}" aria-busy="true">
        <iframe title="${e(entry.name)} 的 HTML 小预览" sandbox="allow-scripts" referrerpolicy="no-referrer" allow="camera 'none'; microphone 'none'; geolocation 'none'; fullscreen 'none'" width="960" height="720" tabindex="-1" aria-hidden="true"></iframe>
        <span class="pelican-thumbnail-status" data-preview-status>正在载入 HTML 作品…</span>
        <button class="pelican-thumbnail-open" type="button" data-pelican-original="${e(entry.id)}" aria-label="放大查看 ${e(entry.name)} 的 HTML 作品"><span>放大查看 ↗</span></button>
      </div>
      <figcaption><button class="pelican-original-button" type="button" data-pelican-original="${e(entry.id)}" aria-label="查看 ${e(entry.name)} 的 HTML 作品">查看 HTML 作品</button><a href="${e(pathFor(base, entry.artifact.src))}" download="${e(entry.id)}.html">下载 HTML ↓</a></figcaption>
    </figure>` : '<div class="pelican-html-missing">HTML 原作待补充</div>';
    const tied = entry.manual && scored.filter(other => other.manual!.total === entry.manual!.total).length > 1;
    const marks = entry.manual ? `<div class="pelican-manual-score"><strong>${entry.manual.total}<span> / 10</span></strong>${tied ? '<span class="pelican-tied">同分</span>' : ''}</div>
      <details class="pelican-manual-detail"><summary>五项评分</summary><dl>${pelicanManualCriteria.map(item => `<div><dt>${item.label}</dt><dd>${entry.manual!.scores[item.id]} / 2</dd></div>`).join('')}</dl></details>` : '<p class="pelican-material-note">待人工评分</p>';
    return `<li class="pelican-showcase-entry" id="pelican-entry-${e(entry.id)}" data-model-id="${e(entry.id)}"${entry.manual ? ` data-score="${entry.manual.total}"` : ''}>
      <div class="pelican-work-info"><div class="pelican-model">${mark(catalog, entry.providerId, base)}<div><h3>${e(entry.name)}</h3><span>${e(provider.shortName)}</span></div></div>
      ${marks}
      ${entry.note ? `<p class="pelican-material-note">${e(entry.note)}</p>` : ''}
      </div>${artwork}</li>`;
  };
  return `${scored.length ? `<div class="pelican-ranked-showcase"><div class="pelican-rank-rail" aria-hidden="true"><span>夯</span><i></i><span>拉</span></div><ul class="pelican-entries pelican-showcase" aria-label="从夯到拉，人工总分从高到低，同分并列">${scored.map(renderEntry).join('')}</ul></div>` : ''}
    ${pending.length ? `<section class="pelican-unscored"><h3>待人工评分</h3><ul class="pelican-entries pelican-showcase" aria-label="待评分作品，不参与排名">${pending.map(renderEntry).join('')}</ul></section>` : ''}`;
}
