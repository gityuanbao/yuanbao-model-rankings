import { verificationText, freshnessLabels } from './pricing-metadata';
import type { Catalog, Model } from './schema';
import { billingLabels, metricLabels, money, rankRows, scenarios, statusLabels, tokens, type Filters, type Metric, type SortOrder, type Row } from './ranking';
import { serializeFilters } from './url-state';
import { pendingPriceProviders } from './price-coverage';

export const escapeHtml = (value: unknown) => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
export const pathFor = (base: string, path = '') => `${base.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
export const modelUrl = (base: string, id: string, filters?: Filters) => `${pathFor(base, `models/${id}/`)}${filters ? serializeFilters(filters) : ''}`;
export function mark(catalog: Catalog, providerId: string, base = '/') {
  const provider = catalog.providers.find(p => p.id === providerId)!;
  return `<span class="provider-mark" aria-hidden="true"><img src="${pathFor(base, `logos/${provider.id}.svg`)}" width="24" height="24" alt="" decoding="async" /></span>`;
}
export function renderPriceCoverage(catalog: Catalog, filters: Filters, base: string) {
  return pendingPriceProviders(catalog, filters).map(({ provider, reason }) =>
    `<p>${mark(catalog, provider.id, base)}<span><strong>${escapeHtml(provider.shortName)} · 价格待核验</strong><span>${escapeHtml(reason)}</span></span></p>`).join('');
}
function renderPriceState(model: Model) {
  const tags: string[] = [];
  if (model.status !== 'active') {
    const label = model.status === 'deprecated' ? '仅存量' : statusLabels[model.status];
    tags.push(`<span class="status-tag ${model.status}">${label}</span>`);
  }
  const state = model.verification?.status;
  const label = state === 'stale' ? '沿用旧价' : state === 'manual_review' ? '变价待审核' : state === 'unknown' ? '价格未核验' : state === 'deprecated' && model.status !== 'retired' && model.status !== 'deprecated' ? '官方停止提供' : '';
  const verification = verificationText(model.verification, model.verifiedAt);
  if (label) tags.push(`<span class="status-tag verification-caution" title="${escapeHtml(verification)}">${label}</span>`);
  if (verification.includes('超过 7 天')) tags.push('<span class="status-tag verification-caution">超过 7 天未核验</span>');
  return tags.length ? `<div class="price-state-tags">${tags.join('')}</div>` : '';
}
export function renderRows(rows: Row[], catalog: Catalog, filters: Filters, base: string) {
  return rows.map(row => {
    const { model } = row;
    const provider = catalog.providers.find(p => p.id === model.providerId)!;
    const source = catalog.sources.find(s => s.id === model.sourceId)!;
    const label = row.applied === 'standard' ? (model.rates.length > 1 ? '阶梯计费' : '') : billingLabels[row.applied];
    return `<tr data-model-id="${escapeHtml(model.id)}" class="${row.rank === 1 ? 'winner-row' : ''}">
      <td class="rank-cell"><span class="rank-number ${row.rank <= 3 ? 'top-rank' : ''}">${row.rank < 10 ? '0' : ''}${row.rank}</span>${row.tied ? '<span class="tie-label">并列</span>' : ''}</td>
      <th scope="row"><a class="model-link" href="${modelUrl(base, model.id, filters)}">${mark(catalog, model.providerId, base)}<span><span class="model-name">${escapeHtml(model.name)}</span><span class="model-meta">${model.status !== 'active' ? `<span class="status-tag ${model.status}">${statusLabels[model.status]}</span>` : ''}${label ? `<span class="billing-tag">${label}</span>` : ''}</span></span></a></th>
      <td class="provider-cell">${escapeHtml(provider.shortName)}</td>
      <td class="numeric ${filters.metric === 'input' ? 'selected-col' : ''}">¥${money(row.input)}</td>
      <td class="numeric ${filters.metric === 'output' ? 'selected-col' : ''}">¥${money(row.output)}</td>
      <td class="numeric muted">${row.cache === null ? '<span title="未核验缓存读取价，不按免费处理">—</span>' : `¥${money(row.cache)}`}</td>
      <td class="numeric context-cell">${tokens(model.contextTokens)}</td>
      <td class="numeric task-price ${filters.metric === 'task' ? 'selected-col' : ''}">¥${money(row.task, true)}</td>
      <td class="numeric ratio-cell">${row.ratio === null ? '<span title="当前最低价为 0，付费模型的倍数无法定义">—</span>' : `<span class="ratio ${row.ratio === 1 ? 'best-ratio' : ''}">${+row.ratio.toFixed(2)}×</span>`}</td>
      <td class="verified-cell" title="${escapeHtml(verificationText(model.verification, model.verifiedAt))}"><time datetime="${model.verification?.lastSuccessAt ?? model.verifiedAt}">${model.verification?.lastSuccessAt ? new Intl.DateTimeFormat('sv-SE', {timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(model.verification.lastSuccessAt)) : model.verifiedAt}</time>${model.verification ? `<span class="index-note ${model.verification.status !== 'fresh' ? 'verification-caution' : ''}">${escapeHtml(freshnessLabels[model.verification.status])}</span>` : ''}${verificationText(model.verification, model.verifiedAt).includes('超过 7 天') ? '<span class="index-note verification-caution">⚠ 超过 7 天未核验</span>' : ''}</td>
      <td class="source-cell"><a href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(source.title)}" aria-label="查看 ${escapeHtml(model.name)} 官方定价">↗</a></td>
    </tr>`;
  }).join('');
}
export function renderMobileRows(rows: Row[], catalog: Catalog, filters: Filters, base: string) {
  return rows.map(row => {
    const provider = catalog.providers.find(p => p.id === row.model.providerId)!;
    const source = catalog.sources.find(s => s.id === row.model.sourceId)!;
    const rateIndex = row.model.rates.findIndex(rate => rate.upToInputTokens === row.rate.upToInputTokens);
    const lowerBound = rateIndex > 0 ? `${row.model.rates[rateIndex - 1].upToInputTokens.toLocaleString('zh-CN')} < ` : '';
    const tier = `${lowerBound}输入 ≤ ${row.rate.upToInputTokens.toLocaleString('zh-CN')} Token${row.model.rates.length > 1 ? '（阶梯计费）' : ''}`;
    const applied = `${billingLabels[row.applied]}${row.applied === 'cache' ? `（命中 ${filters.cachePercent}%）` : row.applied !== filters.billing ? '（所选优惠未适用）' : ''}`;
    const fields = [
      ['当前计费', applied], ['本次适用档位', escapeHtml(tier)],
      ['输入价格', `¥${money(row.input)} / 百万 Token`], ['输出价格', `¥${money(row.output)} / 百万 Token`],
      ['缓存读取', row.cache === null ? '未核验' : `¥${money(row.cache)} / 百万 Token`],
      ['上下文', tokens(row.model.contextTokens)], ['任务成本', `¥${money(row.task, true)} / 次`],
      ['相对最低价', row.ratio === null ? '最低价为 0，倍数不适用' : `${+row.ratio.toFixed(2)}×`],
      ['模型状态', statusLabels[row.model.status]], ['最后核验', escapeHtml(verificationText(row.model.verification, row.model.verifiedAt))],
    ];
    return `<article class="mobile-result" data-model-id="${escapeHtml(row.model.id)}"><div class="mobile-result-main"><span class="mobile-rank">${String(row.rank).padStart(2, '0')}${row.tied ? '<small>并列</small>' : ''}</span><a class="mobile-model" href="${modelUrl(base, row.model.id, filters)}">${mark(catalog, row.model.providerId, base)}<span class="mobile-model-text"><strong>${escapeHtml(row.model.name)}</strong><span>${escapeHtml(provider.shortName)} · ${escapeHtml(row.model.regionLabel)}</span></span></a><div class="mobile-cost"><strong>¥${money(row[filters.metric], filters.metric === 'task')}</strong><span>${filters.metric === 'task' ? '每次任务' : '每百万 Token'}</span></div></div>${renderPriceState(row.model)}<details><summary>完整费率与来源 <span aria-hidden="true">＋</span></summary><dl>${fields.map(([key, value]) => `<div><dt>${key}</dt><dd>${value}</dd></div>`).join('')}</dl><a class="source-link" href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer">官方定价 ↗</a></details></article>`;
  }).join('');
}
export function renderChampions(rows: Row[], catalog: Catalog, filters: Filters, base: string) {
  const taskName = filters.scenario === 'custom' ? '自定义任务' : scenarios[filters.scenario].name;
  return (['input', 'output', 'task'] as const).map((metric, i) => {
    const sorted = rankRows(rows, metric);
    const winner = sorted[0];
    const title = metric === 'task' ? `${taskName}成本最低` : `${metric === 'input' ? '输入' : '输出'}最便宜`;
    const top = sorted.filter(row => row.rank === 1);
    const paid = sorted.find(row => row[metric] > 0);
    const others = top.slice(1);
    return `<article class="champion-card champion-${i}"><div class="champion-label"><span class="champion-icon" aria-hidden="true">${['↙', '↗', '▥'][i]}</span><h2>${title}</h2><span class="first-badge">NO. 1</span></div>
      ${winner ? `<div class="champion-model">${mark(catalog, winner.model.providerId, base)}<a title="${escapeHtml(winner.model.regionLabel)}" href="${modelUrl(base, winner.model.id, filters)}">${escapeHtml(winner.model.name)}</a>${top.length > 1 ? `<span class="muted">等 ${top.length} 款</span>` : ''}</div>
      ${renderPriceState(winner.model)}
      <div class="champion-price"><span class="currency-symbol">¥</span>${money(winner[metric], metric === 'task')}<span class="price-unit">/ ${metric === 'task' ? '次任务' : '百万 Token'}</span></div>
      ${paid && winner[metric] === 0 ? `<div class="champion-foot">付费最低 <a href="${modelUrl(base, paid.model.id, filters)}">${escapeHtml(paid.model.name)}</a><strong>¥${money(paid[metric], metric === 'task')}</strong></div>` : ''}
      ${others.length ? `<details class="tied-winners"><summary>查看其他并列冠军</summary>${others.map(row => `<a href="${modelUrl(base, row.model.id, filters)}">${escapeHtml(row.model.name)}</a>`).join('')}</details>` : ''}` : '<div class="champion-empty">暂无符合条件的模型</div><p class="muted">调整筛选后查看冠军</p>'}</article>`;
  }).join('');
}
export function renderTableHead(metric: Metric, order: SortOrder = 'asc') {
  const direction = order === 'asc' ? 'ascending' : 'descending';
  const arrow = order === 'asc' ? '↑' : '↓';
  const minimumPriceHelp = `按当前筛选结果的${metricLabels[metric]}比较：1× 为最低价，3× 表示价格是最低价的 3 倍。切换筛选或价格指标时会重新计算。`;
  return `<tr><th scope="col"><abbr title="按价格从低到高计算；切换显示顺序不改变价格排名">价格排名</abbr></th><th scope="col">模型</th><th scope="col">厂商</th>${(['input', 'output'] as const).map(m => `<th scope="col" class="numeric ${metric === m ? 'selected-col' : ''}" aria-sort="${metric === m ? direction : 'none'}"><button type="button" data-sort-column data-metric="${m}" aria-label="${metricLabels[m]}，${metric === m ? `当前${order === 'asc' ? '升序' : '降序'}，点击切换顺序` : '点击排序'}">${metricLabels[m]} ${metric === m ? arrow : '↕'}</button></th>`).join('')}<th scope="col" class="numeric"><abbr title="已命中缓存的输入读取价；不含缓存写入和存储费">缓存读取</abbr></th><th scope="col" class="numeric">上下文</th><th scope="col" class="numeric ${metric === 'task' ? 'selected-col' : ''}" aria-sort="${metric === 'task' ? direction : 'none'}"><button type="button" data-sort-column data-metric="task" aria-label="任务成本，${metric === 'task' ? `当前${order === 'asc' ? '升序' : '降序'}，点击切换顺序` : '点击排序'}">任务成本 ${metric === 'task' ? arrow : '↕'}</button></th><th scope="col" class="numeric"><abbr title="${minimumPriceHelp}" aria-label="相对最低价。${minimumPriceHelp}">相对最低价</abbr></th><th scope="col">最后核验</th><th scope="col">来源</th></tr>`;
}
