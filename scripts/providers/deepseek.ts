import { adapter, tables, grid, one, amount, candidate, perModel, text, document, equalFactor } from './shared';
export default adapter('deepseek', 'https://api-docs.deepseek.com/quick_start/pricing/', (raw, models) => {
  const rows = grid(one(tables(raw).filter(t => text(t).includes('CACHE MISS')), 'DeepSeek 标准定价表'));
  const header = one(rows.filter(r => r[0] === 'MODEL'), 'MODEL 行');
  const pageText = text(document(raw));
  if (!/01:00\s*-\s*04:00 and 06:00\s*-\s*10:00 UTC, Monday through Friday/.test(pageText)) throw new Error('峰谷时段说明发生变化，需人工适配');
  const discoveries = header.slice(3).filter(id => !models.some(m => m.apiId === id)).map(apiId => ({ apiId, label: apiId, sourceUrl: raw.url }));
  return perModel(models, model => {
    const column = header.indexOf(model.apiId); if (column < 3) throw new Error('模型不在官方表格中；不自动视为下架');
    const value = (kind: string, mode: string) => amount(one(rows.filter(r => r[1] === kind && r[2] === mode), `${kind} ${mode}`)[column], 'USD');
    const input = value('1M INPUT TOKENS (CACHE MISS)', 'PEAK'), output = value('1M OUTPUT TOKENS', 'PEAK'), cacheRead = value('1M INPUT TOKENS (CACHE HIT)', 'PEAK');
    const factor = equalFactor(input, output, value('1M INPUT TOKENS (CACHE MISS)', 'OFF-PEAK'), value('1M OUTPUT TOKENS', 'OFF-PEAK'));
    if (cacheRead > 0 && Math.abs(value('1M INPUT TOKENS (CACHE HIT)', 'OFF-PEAK') / cacheRead - factor) > 1e-9) throw new Error('缓存低峰折扣不一致');
    if (one(rows.filter(r => r[0] === 'CONTEXT LENGTH'), '上下文')[column] !== '1M') throw new Error('上下文限制变化');
    return candidate(raw, model, [{ ...model.rates[0], input, output, cacheRead, offPeakFactor: factor }], {
      currency: 'USD', modelLabel: header[column], unitLabel: '1M tokens', inputLabel: 'INPUT TOKENS (CACHE MISS)', outputLabel: 'OUTPUT TOKENS', standardLabel: 'PEAK', structure: 'deepseek-matrix-v1',
      excerpt: rows.filter(r => /PRICING/.test(r[0])).map(r => `${r[1]} | ${r[2]} | ${r[column]}`).join('\n'),
    });
  }, discoveries);
});
