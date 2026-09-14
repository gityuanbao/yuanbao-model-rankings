import type { Catalog } from './schema';
import { escapeHtml as e, mark, pathFor } from './render';
import { getPelicanCounts, getPelicanRankGroups, getPelicanScore, getPelicanTier, isPelicanV3Entry, isPelicanVerified, pelicanCriteria, pelicanTiers, type PelicanEntry, type PelicanV3Entry, type PelicanFilters } from './pelican';

export function renderPelicanLeaders(rows: PelicanEntry[], catalog: Catalog, base: string, hasResults: boolean) {
  const counts = getPelicanCounts(rows);
  if (!counts.verified) {
    const cards = [
      { label: '本次作品', value: counts.total, unit: '份', detail: hasResults ? '当前筛选 · 白猫骑车' : '等待提交测试作品' },
      { label: '待原作核验', value: counts.provisional, unit: '份', detail: '画面观察分仅供参考' },
      { label: '正式上榜', value: 0, unit: '个', detail: '核验与复核后再定档' },
    ];
    return cards.map(card => `<article class="champion-card pelican-leader pelican-status-card"><div class="champion-label"><h2>${card.label}</h2></div><div class="champion-price">${card.value}<span class="price-unit">${card.unit}</span></div><div class="pelican-leader-meta">${card.detail}</div></article>`).join('');
  }
  const groups = getPelicanRankGroups(rows).filter(group => group.rank <= 3);
  return Array.from({ length: 3 }, (_, index) => {
    const group = groups[index];
    if (!group) return '<article class="champion-card pelican-leader"><div class="champion-label"><h2>当前筛选 · 正式成绩</h2></div><div class="champion-model"><span>暂无更多独立名次</span></div><div class="pelican-leader-meta">同分模型并列展示</div><div class="champion-price">—<span class="price-unit">鹈鹕档位</span></div></article>';
    const entry = group.entries[0];
    const tier = pelicanTiers.find(item => item.id === getPelicanTier(entry))!;
    const rank = ['第一名', '第二名', '第三名'][group.rank - 1];
    return `<article class="champion-card pelican-leader"><div class="champion-label"><h2>当前筛选 · 领先模型</h2><span class="first-badge">${group.entries.length > 1 ? '并列' : ''}${rank}</span></div>
      ${group.entries.map(model => `<div class="champion-model">${mark(catalog, model.providerId, base)}<a href="#pelican-entry-${e(model.id)}">${e(model.name)}</a></div>`).join('')}
      <div class="pelican-leader-meta">${isPelicanV3Entry(entry) ? `${getPelicanScore(entry).total} / 100 分 · 已核验` : e(catalog.providers.find(provider => provider.id === entry.providerId)!.shortName)}</div><div class="champion-price">${tier.label}<span class="price-unit">鹈鹕档位</span></div>
    </article>`;
  }).join('');
}

function renderAssessment(entry: PelicanV3Entry) {
  const scores = getPelicanScore(entry);
  const provisional = entry.assessment.status === 'provisional';
  const score = provisional
    ? scores.visual === null ? `画面观察待补充 · 已完成 ${scores.visualCompleted} / 9 项` : `画面观察分 ${scores.visual} / 90`
    : `正式成绩 ${scores.total} / 100`;
  const info: Array<[string, string]> = [
    ['回传型号', entry.test.modelLabel],
    ['型号核实', entry.test.identityStatus === 'verified' ? '已核实' : '按回传记录，待核实'],
    ['测试平台', entry.test.platform ?? '待补充'],
    ['实际档位', entry.test.effort ?? '待补充'],
    ['测试日期', entry.test.date ?? '待补充'],
    ['工具状态', { unknown: '待补充', none: '未开启', enabled: '已开启' }[entry.test.tools]],
    ['代码改动', entry.test.codeModified === null ? '待确认' : entry.test.codeModified ? '有修改' : '未修改'],
    ['首次生成', entry.test.firstAttempt === null ? '待确认' : entry.test.firstAttempt ? '已确认' : '非首次生成'],
    ['提示词核实', { unknown: '待核实', exact: '与统一提示词一致', variant: '措辞有差异，暂不参与同题排名' }[entry.test.promptStatus]],
    ['评分记录', `AI ${provisional ? '画面初评' : '评分'} · ${entry.assessment.reviewedAt}`],
    ['源宝复核', entry.assessment.ownerConfirmed ? '已复核' : '待复核'],
  ];
  if (entry.test.promptText) info.push(['实际提示词', entry.test.promptText]);
  return `<div class="pelican-score"><strong>${e(score)}</strong>${provisional ? '<span>网页与 SVG 10 分待核验 · 不参与正式定档</span>' : ''}</div>
    <details class="pelican-assessment"><summary>评分明细与测试记录</summary><dl class="pelican-score-list">${pelicanCriteria.map(criterion => {
      const item = entry.assessment.criteria.find(item => item.id === criterion.id)!;
      return `<div class="pelican-score-item"><dt>${criterion.label}<span>${item.score === null ? '待核验' : `${item.score} / ${criterion.maximum}`}</span></dt><dd class="pelican-score-reason">${e(item.reason)}${item.evidenceTimes.length ? `<span class="pelican-score-evidence">录屏 ${item.evidenceTimes.map(time => `${time} 秒`).join('、')}</span>` : ''}</dd></div>`;
    }).join('')}</dl><dl class="pelican-test-info">${info.map(([label, value]) => `<div><dt>${label}</dt><dd>${e(value)}</dd></div>`).join('')}</dl>${entry.test.notes.length ? `<ul class="pelican-test-notes">${entry.test.notes.map(note => `<li>${e(note)}</li>`).join('')}</ul>` : ''}</details>`;
}

function renderEntry(entry: PelicanEntry, catalog: Catalog, base: string) {
  const provider = catalog.providers.find(provider => provider.id === entry.providerId)!;
  const modern = isPelicanV3Entry(entry);
  const media = modern ? `<figure class="pelican-media"><video controls loop muted playsinline preload="none" poster="${e(pathFor(base, entry.media.poster))}" src="${e(pathFor(base, entry.media.src))}" width="${entry.media.width}" height="${entry.media.height}" aria-label="${e(entry.name)} 的白猫骑车作品录屏" data-pelican-video>当前浏览器不支持播放视频，<a href="${e(pathFor(base, entry.media.src))}">打开作品视频</a>。</video><figcaption><a href="${e(pathFor(base, entry.media.poster))}" target="_blank" rel="noopener noreferrer">查看静态封面 ↗</a></figcaption><p class="pelican-media-fallback" data-pelican-media-error hidden role="status">作品暂时加载失败，<a href="${e(pathFor(base, entry.media.src))}" target="_blank" rel="noopener noreferrer">打开原视频</a>或稍后再试；加载失败不计作模型失分。</p></figure>`
    : `<a class="pelican-artwork" href="${e(pathFor(base, entry.gif))}" target="_blank" rel="noopener noreferrer" aria-label="查看 ${e(entry.name)} 鹈鹕测试 GIF 原图"><img src="${e(pathFor(base, entry.gif))}" alt="${e(entry.name)} 的鹈鹕测试作品" width="480" height="360" loading="lazy" decoding="async" /></a>`;
  return `<li class="pelican-entry" id="pelican-entry-${e(entry.id)}" data-model-id="${e(entry.id)}"><div class="pelican-entry-heading"><div class="pelican-model">${mark(catalog, entry.providerId, base)}<div><h4>${e(entry.name)}</h4><span>${e(provider.shortName)}</span></div></div>${modern ? `<span class="pelican-entry-status">${isPelicanVerified(entry) ? '已核验' : '待原作核验'}</span>` : ''}</div>${media}${modern ? renderAssessment(entry) : ''}</li>`;
}

export function renderPelicanTiers(rows: PelicanEntry[], catalog: Catalog, base: string, order: PelicanFilters['order']) {
  const tiers = order === 'asc' ? [...pelicanTiers].reverse() : pelicanTiers;
  const formal = rows.filter(isPelicanVerified);
  const pending = rows.filter(entry => !isPelicanVerified(entry));
  const formalHtml = `<div class="pelican-formal-tiers">${tiers.map(tier => {
    const entries = formal.filter(entry => getPelicanTier(entry) === tier.id);
    return `<section class="pelican-tier pelican-tier-${tier.id}" aria-labelledby="tier-${tier.id}">
      <h3 id="tier-${tier.id}" class="pelican-tier-label"><span class="pelican-tier-dot" aria-hidden="true"></span><span>${tier.label}</span></h3>
      ${entries.length ? `<ol class="pelican-entries" id="pelican-entries-${tier.id}" aria-label="${tier.label}档模型，按成绩${order === 'asc' ? '从低到高' : '从高到低'}展示，同分并列">${entries.map(entry => renderEntry(entry, catalog, base)).join('')}</ol>` : '<div class="pelican-vacancy"><span class="sr-only">暂无上榜模型</span><span aria-hidden="true">—</span></div>'}
    </section>`;
  }).join('')}</div>`;
  const pendingHtml = pending.length ? `<section class="pelican-pending-list" aria-labelledby="pelican-pending-title"><div class="pelican-pending-header"><h3 id="pelican-pending-title">白猫骑车 · 作品观察</h3><p class="pelican-pending-note">按提交顺序展示，暂不排名。画面初评由 AI 完成，原始 HTML 与测试记录待补齐。</p></div><ul class="pelican-entries" id="pelican-pending-entries" aria-label="待核验作品，按提交顺序展示">${pending.map(entry => renderEntry(entry, catalog, base)).join('')}</ul></section>` : '';
  return formal.length ? formalHtml + pendingHtml : pendingHtml + `<details class="pelican-formal-placeholder"><summary>正式档位 · 待原作核验后公布</summary>${formalHtml}</details>`;
}
