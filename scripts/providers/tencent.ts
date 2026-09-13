import { adapter, tables, grid, one, candidate, perModel, amount, text, document } from './shared';
export default adapter('tencent', 'https://cloud.tencent.cn/document/product/1729/97731', (raw, models) => {
  const rows = one(tables(raw).map(grid).filter(r => r[0]?.[0] === '产品名' && /^刊例价（每\s*百万 tokens）$/.test(r[0]?.[1] ?? '')), '腾讯刊例价格表');
  const content = text(document(raw));
  if (!/已购买的模型服务可继续使用/.test(content) || !/停止支持新购模型服务/.test(content)) throw new Error('腾讯原平台服务状态变化，需人工核对');
  const discoveries = rows.slice(1).filter(r => /^Hunyuan-/i.test(r[0]) && !/embedding/i.test(r[0]) && !models.some(m => m.apiId.toLowerCase() === r[0].toLowerCase())).map(r => ({ apiId: r[0], label: r[0], sourceUrl: raw.url }));
  return perModel(models, model => {
    const row = one(rows.filter(r => r[0].toLowerCase() === model.apiId.toLowerCase()), model.apiId);
    const match = row[1].match(/^输入：([\d.]+)元 输出：([\d.]+)元$/); if (!match) throw new Error('腾讯输入/输出费率格式变化');
    const item = candidate(raw, model, [{ ...model.rates[0], input: amount(match[1], 'CNY'), output: amount(match[2], 'CNY') }], {
      currency: 'CNY', modelLabel: row[0], unitLabel: '元/百万 tokens', inputLabel: '输入', outputLabel: '输出', standardLabel: '刊例价', structure: 'tencent-token-table-v1', excerpt: row.join(' | '),
    });
    item.status = 'deprecated'; return item;
  }, discoveries);
});
