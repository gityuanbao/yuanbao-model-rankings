import { adapter, tables, grid, one, amount, candidate, perModel, equalFactor } from './shared';
export default adapter('baidu', 'https://cloud.baidu.com/doc/qianfan/s/wmh4sv6ya', (raw, models) => {
  const expected = ['模型名称', '版本名称', '服务内容', '子项', '在线推理', '批量推理', '单位'];
  const matches = tables(raw).map(grid).filter(r => JSON.stringify(r[0]) === JSON.stringify(expected) && r.some(row => /ERNIE-4\.5-Turbo-32K/i.test(row[1])));
  const rows = one(matches, '百度文本按量后付费表');
  const discoveredIds = [...new Set(rows.slice(1).map(r => r[1]).filter(id => /^ERNIE-[\w.-]+$/.test(id)))];
  const discoveries = discoveredIds.filter(id => !models.some(m => m.apiId.toLowerCase() === id.toLowerCase())).map(apiId => ({ apiId, label: apiId, sourceUrl: raw.url }));
  return perModel(models, model => {
    const matching = rows.filter(r => r[1]?.toLowerCase() === model.apiId.toLowerCase() && r[2] === '推理服务');
    const row = (kind: string) => { const r = one(matching.filter(r => r[3] === kind), `${model.apiId} ${kind}`); if (r[6] !== '元/千tokens') throw new Error('百度计费单位变化'); return r; };
    const inputRow = row('输入'), outputRow = row('输出'), cacheRow = row('命中缓存');
    const input = amount(inputRow[4], 'CNY', 1000), output = amount(outputRow[4], 'CNY', 1000);
    const batchFactor = /^--?$/.test(inputRow[5]) && /^--?$/.test(outputRow[5]) ? null : equalFactor(input, output, amount(inputRow[5], 'CNY', 1000), amount(outputRow[5], 'CNY', 1000));
    return candidate(raw, model, [{ ...model.rates[0], input, output, cacheRead: amount(cacheRow[4], 'CNY', 1000), batchFactor }], {
      currency: 'CNY', modelLabel: inputRow[1], unitLabel: '元/千tokens × 1000 = 元/百万 tokens', inputLabel: '输入', outputLabel: '输出', standardLabel: '在线推理', structure: 'baidu-online-table-v1', excerpt: [inputRow, outputRow, cacheRow].map(r => r.join(' | ')).join('\n'),
    });
  }, discoveries);
});
