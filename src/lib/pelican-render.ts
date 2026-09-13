import type { Catalog } from './schema';
import { escapeHtml as e, mark, pathFor } from './render';
import { getPelicanLeaders, pelicanTiers, type PelicanEntry, type PelicanFilters } from './pelican';

export function renderPelicanLeaders(rows: PelicanEntry[], catalog: Catalog, base: string, hasResults: boolean) {
  const leaders = getPelicanLeaders(rows);
  return ['第一名', '第二名', '第三名'].map((label, index) => {
    const entry = leaders[index];
    const tier = pelicanTiers.find(item => item.id === entry?.tier);
    return `<article class="champion-card pelican-leader"><div class="champion-label"><h2>当前筛选 · 领先模型</h2><span class="first-badge">${label}</span></div>
      ${entry ? `<div class="champion-model">${mark(catalog, entry.providerId, base)}<a href="#pelican-entry-${e(entry.id)}">${e(entry.name)}</a></div><div class="pelican-leader-meta">${e(catalog.providers.find(provider => provider.id === entry.providerId)!.shortName)}</div><div class="champion-price">${tier!.label}<span class="price-unit">鹈鹕档位</span></div>` : `<div class="champion-model"><span>${hasResults ? '暂无符合条件的模型' : '待公布'}</span></div><div class="pelican-leader-meta">${hasResults ? '调整筛选后查看' : '等待首批测试结果'}</div><div class="champion-price">—<span class="price-unit">鹈鹕档位</span></div>`}
    </article>`;
  }).join('');
}

export function renderPelicanTiers(rows: PelicanEntry[], catalog: Catalog, base: string, order: PelicanFilters['order']) {
  const tiers = order === 'asc' ? [...pelicanTiers].reverse() : pelicanTiers;
  return tiers.map(tier => {
    const entries = rows.filter(entry => entry.tier === tier.id);
    return `<section class="pelican-tier pelican-tier-${tier.id}" aria-labelledby="tier-${tier.id}">
      <h3 id="tier-${tier.id}" class="pelican-tier-label"><span class="pelican-tier-dot" aria-hidden="true"></span><span>${tier.label}</span></h3>
      ${entries.length ? `<ol class="pelican-entries" id="pelican-entries-${tier.id}" aria-label="${tier.label}档模型，按人工顺序${order === 'asc' ? '倒序' : '排列'}">${entries.map(entry => `<li class="pelican-entry" id="pelican-entry-${e(entry.id)}" data-model-id="${e(entry.id)}">
        <div class="pelican-model">${mark(catalog, entry.providerId, base)}<div><h4>${e(entry.name)}</h4><span>${e(catalog.providers.find(provider => provider.id === entry.providerId)!.shortName)}</span></div></div>
        <a class="pelican-artwork" href="${e(pathFor(base, entry.gif))}" target="_blank" rel="noopener noreferrer" aria-label="查看 ${e(entry.name)} 鹈鹕测试 GIF 原图"><img src="${e(pathFor(base, entry.gif))}" alt="${e(entry.name)} 的鹈鹕测试作品" width="480" height="360" loading="lazy" decoding="async" /></a>
      </li>`).join('')}</ol>` : '<div class="pelican-vacancy"><span class="sr-only">暂无上榜模型</span><span aria-hidden="true">—</span></div>'}
    </section>`;
  }).join('');
}
