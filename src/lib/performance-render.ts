import type { Catalog } from './schema';
import { escapeHtml as e, mark } from './render';
import type { PerformanceRow } from './performance';
import { agentSignalLabels, performanceCategories, type AgentSignal } from './performance-categories';

export const scoreText = (value:number) => value.toFixed(1);
const modelScore = (row:PerformanceRow) => 'signals' in row ? `#${row.sourceRank}` : row.scorePrecision==='rounded' ? String(row.score) : scoreText(row.score);
const interval = (row:PerformanceRow) => 'signals' in row ? '原榜综合名次' : row.scorePrecision==='rounded' ? `± ${row.uncertainty}` : `${scoreText(row.lower!)}–${scoreText(row.upper!)}`;
const scoreLabel = (row:PerformanceRow) => 'signals' in row ? '原榜综合名次' : 'Arena 得分';
const countLabel = (row:PerformanceRow) => 'signals' in row ? '评估会话' : '对战票数';
const count = (row:PerformanceRow) => ('signals' in row ? row.sessions : row.votes).toLocaleString('zh-CN');
const mode = (row:PerformanceRow) => `${row.mode ? `<span class="performance-mode">${e(row.mode)}</span>` : ''}${'preliminary' in row && row.preliminary?'<span class="performance-mode">初步成绩</span>':''}`;
const agentSignals = (row:PerformanceRow) => 'signals' in row ? `<details class="agent-signals"><summary>查看能力信号</summary><dl>${(Object.keys(agentSignalLabels) as AgentSignal[]).map(key=>`<div><dt>${agentSignalLabels[key]}</dt><dd>${row.signals[key].value.toFixed(2)}% <small>± ${row.signals[key].uncertainty.toFixed(2)}%</small></dd></div>`).join('')}</dl><p>相对基准的估计效应，非原始成功率。</p></details>` : '';
export function renderPerformanceRows(rows:PerformanceRow[], catalog:Catalog, base:string) {
  return rows.map(row=>`<tr data-model-id="${e(row.id)}">
    <td class="rank-cell"><span class="rank-number ${row.rank<=3?'top-rank':''}">${String(row.rank).padStart(2,'0')}</span>${row.tied?'<span class="tie-label">并列</span>':''}</td>
    <th scope="row"><div class="performance-model">${mark(catalog,row.providerId,base)}<span><strong>${e(row.name)}</strong><span class="performance-model-meta">${e(catalog.providers.find(p=>p.id===row.providerId)!.shortName)}${mode(row)}</span></span></div>${agentSignals(row)}</th>
    <td class="numeric performance-score"><strong title="${scoreLabel(row)}">${modelScore(row)}</strong>${'signals' in row ? '' : `<span class="performance-interval">${interval(row)}</span>`}</td>
    <td class="numeric performance-votes">${count(row)}</td>
    <td class="numeric performance-original-rank">${'signals' in row ? `${row.signals.netImprovement.value.toFixed(2)}%<span class="performance-interval">± ${row.signals.netImprovement.uncertainty.toFixed(2)}%</span>` : `#${row.sourceRank}`}</td>
    <td class="source-cell"><a href="${row.sourceUrl}" target="_blank" rel="noopener noreferrer" aria-label="查看 ${e(row.name)} 的 Arena 原始数据" title="${e(row.sourceModel)}">↗</a></td>
  </tr>`).join('');
}
export function renderPerformanceMobile(rows:PerformanceRow[], catalog:Catalog, base:string) {
  return rows.map(row=>`<article class="mobile-result" data-model-id="${e(row.id)}"><div class="mobile-result-main"><span class="mobile-rank"><small>本站</small>${String(row.rank).padStart(2,'0')}${row.tied?'<small>并列</small>':''}</span><div class="mobile-model">${mark(catalog,row.providerId,base)}<span class="mobile-model-text"><strong>${e(row.name)}</strong><span>${e(catalog.providers.find(p=>p.id===row.providerId)!.shortName)}${row.mode?` · ${e(row.mode)}`:''}${'preliminary' in row && row.preliminary?' · 初步成绩':''}</span></span></div><div class="mobile-cost"><strong>${modelScore(row)}</strong><span>${scoreLabel(row)}</span></div></div><details><summary>成绩与来源 <span aria-hidden="true">＋</span></summary><dl><div><dt>原榜名次</dt><dd>#${row.sourceRank}</dd></div><div><dt>${countLabel(row)}</dt><dd>${count(row)}</dd></div>${'signals' in row?`<div><dt>净提升</dt><dd>${row.signals.netImprovement.value.toFixed(2)}% ± ${row.signals.netImprovement.uncertainty.toFixed(2)}%</dd></div>`:`<div><dt>${row.scorePrecision==='rounded'?'官方展示区间':'95% 置信区间'}</dt><dd>${interval(row)}</dd></div>`}<div><dt>原始模型名称</dt><dd>${e(row.sourceModel)}</dd></div></dl>${agentSignals(row)}<a class="source-link" href="${row.sourceUrl}" target="_blank" rel="noopener noreferrer">Arena 原始数据 ↗</a></details></article>`).join('');
}
export function renderPerformanceLeaders(rows:PerformanceRow[], catalog:Catalog, base:string) {
  return [...rows].sort((a,b)=>a.rank-b.rank).slice(0,3).map(row=>`<article class="champion-card performance-leader"><div class="champion-label"><h2>${performanceCategories[row.category].label} · 领先模型</h2><span class="first-badge">本站 #${row.rank}</span></div><div class="champion-model">${mark(catalog,row.providerId,base)}<span>${e(row.name)}</span></div><div class="performance-leader-mode">${row.mode?e(row.mode):e(catalog.providers.find(p=>p.id===row.providerId)!.shortName)}</div><div class="champion-price">${modelScore(row)}<span class="price-unit">${scoreLabel(row)}</span></div></article>`).join('');
}
