import { adapter, tables, grid, one, amount, candidate, perModel, text, document, ManualPricingRequiredError } from './shared';
export default adapter('minimax', 'https://platform.minimax.cn/docs/guides/pricing-paygo', (raw, models) => {
  if (!/按量|标准服务/.test(text(document(raw)))) throw new Error('缺少标准按量计费说明');
  const matrices = tables(raw).map(grid).filter(r => r[0]?.[0] === '模型' && r[0]?.[1] === '输入价格 元/百万 tokens' && r[0]?.[2] === '输出价格 元/百万 tokens' && r[0]?.[3] === '缓存读取 元/百万 tokens');
  if (!matrices.length) throw new Error('MiniMax 价格列结构变化');
  const allRows = matrices.flatMap(r => r.slice(1));
  const discoveries = [...new Set(allRows.map(r => r[0].match(/^MiniMax-M[\w.-]+/)?.[0]).filter((id): id is string => !!id))].filter(id => !models.some(m => m.apiId === id)).map(apiId => ({ apiId, label: apiId, sourceUrl: raw.url }));
  return perModel(models, model => {
    if(model.apiId==='MiniMax-M3')throw new ManualPricingRequiredError('M3 含标准/优先服务、划线旧价与 512K 阶梯，当前保留人工核验的完整费率，不套用 M2 解析器');
    const row = one(allRows.filter(r => r[0] === model.apiId), model.apiId);
    return candidate(raw, model, [{ ...model.rates[0], input: amount(row[1], 'CNY'), output: amount(row[2], 'CNY'), cacheRead: amount(row[3], 'CNY') }], {
      currency: 'CNY', modelLabel: row[0], unitLabel: '元/百万 tokens', inputLabel: '输入价格', outputLabel: '输出价格', standardLabel: '按量标准服务', structure: 'minimax-token-table-v1', excerpt: row.slice(0,4).join(' | '),
    });
  }, discoveries);
});
