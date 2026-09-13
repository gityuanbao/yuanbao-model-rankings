import { z } from 'zod';
import { adapter, amount, candidate, fetchOfficial, one, perModel } from './shared';
import { markdownTables, rateLabel } from './markdown';

export const doubaoPricingPage = 'https://docs.volcengine.com/docs/82379/1544106';
export const doubaoPricingApi = 'https://www.volcengine.com/api/doc/getDocDetail?LibraryID=82379&DocumentID=1544106&lang=zh&type=';
const documentSchema = z.object({
  ResponseMetadata: z.object({ Error: z.unknown().optional() }).refine(value => !value.Error, '火山方舟文档接口返回错误'),
  Result: z.object({ LibraryID: z.literal(82379), DocumentID: z.literal(1544106), Title: z.literal('模型价格'), Language: z.literal('zh'), Status: z.literal(2), MDContent: z.string().min(1) }),
});
const doubao = adapter('bytedance', doubaoPricingPage, (raw, models) => {
  const doc = documentSchema.parse(JSON.parse(raw.body)).Result;
  const section = one([...doc.MDContent.matchAll(/^## 在线推理（常规）\s*\n([\s\S]*?)(?=^## |$(?![\s\S]))/gm)], '方舟常规在线推理');
  const table = one(markdownTables(section[1]), '方舟常规在线推理价格表');
  const header = table[0];
  const expected = ['模型名称', '条件 千 token', '输入(非音频) 元/百万token', '输入(音频) 元/百万token', '缓存存储 元/百万token/小时', '缓存命中(非音频) 元/百万token', '缓存命中(音频) 元/百万token', '输出 元/百万token'];
  if (JSON.stringify(header) !== JSON.stringify(expected)) throw new Error('方舟标准价、音频价或缓存列变化');
  let name = '';
  const rows = table.slice(1).map(row => { if (row[0]) name = row[0]; return [name, ...row.slice(1)]; });
  const discoveries = [...new Set(rows.map(row => row[0]))].filter(id => /^doubao-seed-(?:2\.|evolving)/.test(id) && !models.some(model => model.apiId === id)).map(apiId => ({ apiId, label: apiId, sourceUrl: doubaoPricingPage }));
  return perModel(models, model => {
    if (model.region !== 'mainland' || model.currency !== 'CNY') throw new Error('仅适配豆包中国区常规在线推理人民币价');
    const selected = rows.filter(row => row[0] === model.apiId);
    if (!selected.length) throw new Error('方舟标准价格表缺少模型，保留旧价');
    let previousUpper = 0;
    const rates = selected.map((row, index) => {
      const range = row[1].match(/^输入长度 ([\[(])(\d+),\s*(\d+)\]$/);
      if (!range || (index === 0 ? range[1] !== '[' : range[1] !== '(')) throw new Error('方舟输入/输出计费条件无法唯一解析');
      const lower = Number(range[2]) * 1000, upper = Number(range[3]) * 1000;
      if (lower !== previousUpper || upper <= lower) throw new Error('方舟价格阶梯缺失、重叠或倒序');
      previousUpper = upper;
      return { label: model.rates.find(rate => rate.upToInputTokens === upper)?.label ?? rateLabel(upper), upToInputTokens: upper,
        input: amount(row[2], 'CNY'), output: amount(row[7], 'CNY'), cacheRead: amount(row[5], 'CNY'), batchFactor: null, offPeakFactor: null, promotion: null };
    });
    return candidate({ ...raw, url: doubaoPricingPage }, model, rates, {
      currency: 'CNY', modelLabel: model.apiId, unitLabel: '元/百万token', inputLabel: '输入(非音频)', outputLabel: '输出', standardLabel: '在线推理（常规）',
      structure: 'volc-ark-public-document-v1', excerpt: `${header.join(' | ')}\n${selected.map(row => row.join(' | ')).join('\n')}`.slice(0, 2000),
    });
  }, discoveries);
});
export default { ...doubao, fetch: (fetcher?: typeof fetch) => fetchOfficial('bytedance', doubaoPricingApi, fetcher) };
