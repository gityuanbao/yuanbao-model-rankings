import { catalog } from '../lib/catalog';
import { billingLabels, money, quote, type Billing } from '../lib/ranking';
import { parseFilters, serializeFilters } from '../lib/url-state';
const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const input = (id: string) => byId<HTMLInputElement>(id);
const model = catalog.models.find(m => m.id === byId('main').dataset.model)!;
let filters = parseFilters(location.search);
const back = byId<HTMLAnchorElement>('back-to-board');
const baseHref = back.getAttribute('href')!;
function show(sync = true) {
  if (sync) {
    input('detail-input').value = String(filters.inputTokens);
    input('detail-output').value = String(filters.outputTokens);
    input('detail-billing').value = filters.billing;
    input('detail-cache').value = String(filters.cachePercent);
  }
  back.href = baseHref + serializeFilters(filters);
  byId('detail-cache-control').hidden = filters.billing !== 'cache';
  const prices = quote(model, filters, catalog.meta.usdToCny);
  byId('detail-cost-value').textContent = prices ? `¥${money(prices.task, true)}` : '无法估算';
  byId('detail-cost-formula').textContent = prices ? `${filters.inputTokens.toLocaleString('zh-CN')} × ¥${money(prices.input)} ÷ 1,000,000 + ${filters.outputTokens.toLocaleString('zh-CN')} × ¥${money(prices.output)} ÷ 1,000,000` : '当前请求超出已知上下文、输出上限，或缺少该长度费率。';
  byId('detail-calculation-note').textContent = prices ? `按${billingLabels[prices.applied]}计算。${prices.applied !== filters.billing ? '所选优惠尚未核验或已失效，回退到标准价。' : ''}${filters.billing === 'cache' ? `缓存命中比例 ${filters.cachePercent}%；不含首次写入或存储费。` : ''}${prices.applied === 'offpeak' ? '仅限厂商规定的低峰时段。' : ''}仅含文本 Token 费用，以实际账单为准。` : '请减少 Token 数或核对官方完整计费规则。';
}
function update() {
  const form = byId<HTMLFormElement>('detail-calculator');
  if (!form.reportValidity()) return;
  if (input('detail-billing').value === 'cache' && (!input('detail-cache').value || !input('detail-cache').reportValidity())) return;
  filters = { ...filters, scenario: 'custom', inputTokens: Number(input('detail-input').value), outputTokens: Number(input('detail-output').value), billing: input('detail-billing').value as Billing, cachePercent: Number(input('detail-cache').value) };
  history.replaceState(null, '', location.pathname + serializeFilters(filters));
  show();
}
byId('detail-calculator').addEventListener('submit', event => { event.preventDefault(); update(); });
input('detail-billing').addEventListener('change', update);
input('detail-cache').addEventListener('change', update);
window.addEventListener('popstate', () => { filters = parseFilters(location.search); show(); });
show();
