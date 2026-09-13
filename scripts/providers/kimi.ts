import { z } from 'zod';
import { adapter, amount, candidate, one, perModel } from './shared';
import { rateLabel } from './markdown';

const columns = ['模型', '计费单位', '输入价格（缓存命中）', '输入价格（缓存未命中）', '输出价格', '上下文窗口'];
const rowsSchema = z.array(z.tuple([z.string(), z.string(), z.string(), z.string(), z.string(), z.string()])).min(1);
export default adapter('moonshot', 'https://platform.kimi.com/docs/pricing/chat.md', (raw, models) => {
  if (!raw.body.includes('# 模型推理价格说明') || !raw.body.includes('按量计费')) throw new Error('Kimi 标准计费说明缺失');
  const component = one([...raw.body.matchAll(/<DocTable\s+columns=\{([\s\S]*?)\}\s+rows=\{([\s\S]*?)\}\s*\/>/g)], 'Kimi 官方价格表');
  const header = [...component[1].matchAll(/title:\s*"([^"]+)"/g)].map(match => match[1]);
  if (JSON.stringify(header) !== JSON.stringify(columns)) throw new Error('Kimi 输入、输出或缓存列发生变化');
  const rows = rowsSchema.parse(JSON.parse(component[2].trim().replace(/,\s*\]$/, ']')));
  if (new Set(rows.map(row => row[0])).size !== rows.length) throw new Error('Kimi 官方价格表模型重复');
  const discoveries = rows.filter(row => !models.some(model => model.apiId === row[0])).map(row => ({ apiId: row[0], label: row[0], sourceUrl: raw.url }));
  return perModel(models, model => {
    if (model.region !== 'mainland' || model.currency !== 'CNY') throw new Error('仅适配 Kimi 中国区人民币价');
    const row = one(rows.filter(row => row[0] === model.apiId), model.apiId);
    if (row[1] !== '1M tokens' || !row.slice(2, 5).every(value => /^¥\d+(?:\.\d+)?$/.test(value))) throw new Error('Kimi 单位或币种变化');
    const context = row[5].match(/^([\d,]+) tokens$/);
    const upper = context ? Number(context[1].replaceAll(',', '')) : NaN;
    if (upper !== model.contextTokens) throw new Error('Kimi 上下文规格变化，需人工核对');
    return candidate(raw, model, [{ label: model.rates.find(rate => rate.upToInputTokens === upper)?.label ?? rateLabel(upper), upToInputTokens: upper,
      input: amount(row[3], 'CNY'), output: amount(row[4], 'CNY'), cacheRead: amount(row[2], 'CNY'), batchFactor: null, offPeakFactor: null, promotion: null }], {
      currency: 'CNY', modelLabel: row[0], unitLabel: '1M tokens · CNY', inputLabel: header[3], outputLabel: header[4], standardLabel: '按量计费',
      structure: 'kimi-official-mdx-table-v1', excerpt: `${header.join(' | ')}\n${row.join(' | ')}`,
    });
  }, discoveries);
});
