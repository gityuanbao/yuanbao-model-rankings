import { adapter, amount, candidate, one, perModel } from './shared';
import { markdownTables, rateLabel } from './markdown';

export default adapter('zhipu', 'https://docs.bigmodel.cn/cn/guide/start/pricing.md', (raw, models) => {
  if (!raw.body.includes('# API 定价') || !raw.body.includes('按量计费')) throw new Error('智谱 API 标准计费说明缺失');
  const tables = markdownTables(raw.body).filter(table => table[0][0] === '模型名称' && table[0].includes('输入单价（元/百万 Tokens）') && table[0].includes('输出单价（元/百万 Tokens）'));
  if (!tables.length) throw new Error('智谱 Token 标准价格表缺失');
  const known = new Set(models.map(model => model.apiId.toLowerCase()));
  const discoveries = [...new Set(tables.flatMap(table => table.slice(1).map(row => row[0].toLowerCase())))].filter(id => /^glm-5/.test(id) && !known.has(id)).map(apiId => ({ apiId, label: apiId, sourceUrl: raw.url }));
  return perModel(models, model => {
    if (model.region !== 'mainland' || model.currency !== 'CNY') throw new Error('仅适配智谱中国区人民币价');
    const table = one(tables.filter(table => table.slice(1).some(row => row[0].toLowerCase() === model.apiId.toLowerCase())), model.apiId);
    // Output-dependent and multi-tier rates require their own explicit parser.
    const row = one(table.slice(1).filter(row => row[0].toLowerCase() === model.apiId.toLowerCase()), `${model.apiId} 单档标准费率`);
    const header = table[0];
    const value = (label: string) => { const index = header.indexOf(label); if (index < 0) throw new Error(`智谱 ${label} 列缺失`); return row[index]; };
    const limit = value('上下文').match(/^(\d+(?:\.\d+)?)(K|M)$/);
    const upper = limit ? Number(limit[1]) * (limit[2] === 'M' ? 1_000_000 : 1000) : NaN;
    if (upper !== model.contextTokens) throw new Error('智谱上下文或阶梯变化，需人工核对');
    const input = value('输入单价（元/百万 Tokens）'), output = value('输出单价（元/百万 Tokens）');
    if (input === '免费' || output === '免费') throw new Error('官方免费型号由人工核验免费依据，自动更新不发布零价');
    const cache = value('缓存命中（元/百万 Tokens）');
    return candidate(raw, model, [{ label: model.rates.find(rate => rate.upToInputTokens === upper)?.label ?? rateLabel(upper), upToInputTokens: upper,
      input: amount(input, 'CNY'), output: amount(output, 'CNY'), cacheRead: cache === '不支持' ? null : amount(cache, 'CNY'), batchFactor: null, offPeakFactor: null, promotion: null }], {
      currency: 'CNY', modelLabel: row[0], unitLabel: '元/百万 Tokens', inputLabel: '输入单价', outputLabel: '输出单价', standardLabel: '按量计费',
      structure: 'glm-official-markdown-flat-v1', excerpt: `${header.join(' | ')}\n${row.join(' | ')}`,
    });
  }, discoveries);
});
