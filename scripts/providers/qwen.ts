import { adapter, tables, grid, one, candidate, perModel, amount, text, document, children } from './shared';
function standardAmount(value:string) {
  // Only this explicit original-price label may contain a second discount number.
  // Never pick a number from an unlabeled promotion or a strike-through pair.
  const original=value.match(/^原价\s+(\d+(?:\.\d+)?)\s*元\s*（限时\s+\d+(?:\.\d+)?\s*折）$/);
  return amount(original?`${original[1]} 元`:value,'CNY');
}
export default adapter('alibaba', 'https://help.aliyun.com/zh/model-studio/model-pricing', (raw, models) => {
  if (!/本文仅展示模型调用\s*原价/.test(text(document(raw)))) throw new Error('阿里云原价说明缺失');
  // Bind to the region heading, never a table index or the first repeated model name.
  const matrices = tables(raw).map(table => {
    const region = children(table.parentNode!).filter(n => /^h[1-6]$/.test(n.nodeName)).map(text)[0] ?? '';
    return { region, rows: grid(table) };
  });
  const getTables = (region: string) => matrices.filter(t => region === 'mainland' ? /^华北\s*2（北京）$/.test(t.region) : region === 'singapore' ? t.region === '新加坡' : false)
    .filter(t => t.rows[0]?.[0] === '模型 ID（Model ID）' && t.rows[0].includes('输入单价（每百万 Token）') && t.rows[0].some(s => s.startsWith('输出单价（每百万 Token）')));
  if (!getTables('mainland').length) throw new Error('北京地域标准价格表无法定位');
  const known = new Set(models.map(m => m.apiId));
  const discoveries = [...new Set(getTables('mainland').flatMap(t => t.rows.slice(1).map(r => r[0].split(/\s/)[0])).filter(id => /^qwen(?:3[.\d-]*|)-?(?:max|flash|plus|coder)/.test(id)))].filter(id => !known.has(id)).map(apiId => ({ apiId, label: apiId, sourceUrl: raw.url }));
  return perModel(models, model => {
    const table = one(getTables(model.region).filter(t => t.rows.slice(1).some(r => r[0].split(/\s/)[0] === model.apiId)), `${model.apiId} ${model.region}`);
    const header = table.rows[0]; const inputColumn = header.indexOf('输入单价（每百万 Token）'), outputColumns=header.flatMap((h,i)=>h.startsWith('输出单价（每百万 Token）')?[i]:[]), outputColumn=outputColumns[0], lengthColumn = header.findIndex(h=>/^单次请求的输入 Token (?:数|范围)$/.test(h));
    if (lengthColumn < 0) throw new Error('输入长度列缺失');
    const rows = table.rows.slice(1).filter(r => r[0].split(/\s/)[0] === model.apiId);
    let previousUpper = 0;
    const rates = rows.map(row => {
      const range = row[lengthColumn].replace(/\s/g, '').match(/^(\d+(?:\.\d+)?)([KM]?)<Token≤(\d+(?:\.\d+)?)([KM]?)$/i);
      if (!range) throw new Error('阶梯范围无法唯一解析');
      const count = (number: string, unit: string) => Number(number) * (unit.toUpperCase() === 'M' ? 1_000_000 : unit.toUpperCase() === 'K' ? 1000 : 1);
      const lower = count(range[1], range[2]), upper = count(range[3], range[4]);
      if (lower !== previousUpper || upper <= lower) throw new Error('价格阶梯有缺口、重叠或倒序'); previousUpper = upper;
      const old = model.rates.find(r => r.upToInputTokens === upper);
      const output=standardAmount(row[outputColumn]);
      if(outputColumns.some(column=>standardAmount(row[column])!==output))throw new Error('思考与非思考输出费率不同，需独立核对模式');
      return { label: old?.label ?? `输入不超过 ${upper.toLocaleString('en-US')} Token`, upToInputTokens: upper, input: standardAmount(row[inputColumn]), output, cacheRead: null, batchFactor: /Batch 调用 半价/.test(row[0]) ? 0.5 : null, offPeakFactor: null, promotion: null };
    });
    return candidate(raw, model, rates, { currency: 'CNY', modelLabel: rows[0][0], unitLabel: '元/百万 Token', inputLabel: '输入单价', outputLabel: '输出单价', standardLabel: `原价 · ${table.region}`, structure: 'qwen-region-tiers-v1', excerpt: rows.map(r => r.slice(0, outputColumn + 1).join(' | ')).join('\n').slice(0,2000) });
  }, discoveries);
});
