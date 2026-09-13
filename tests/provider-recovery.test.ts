import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import additions from '../data/pricing/reviewed-provider-additions-2026-09-12.json';
import corrections from '../data/pricing/reviewed-provider-corrections-2026-09-12.json';
import { fixtureCatalog } from './fixtures/catalog';
import { catalogSchema, modelSchema } from '../src/lib/schema';
import { defaultFilters, quote } from '../src/lib/ranking';
import { pendingPriceProviders } from '../src/lib/price-coverage';
import { renderPriceCoverage } from '../src/lib/render';
import { addReviewedModels } from '../scripts/pricing/add-reviewed';
import { evaluateUpdates } from '../scripts/pricing/pipeline';
import { hash, meaningfulCatalog, officialPrice, stable } from '../scripts/pricing/diff';
import { normalizedPriceSchema, type ProviderId, type RawPricingSnapshot } from '../scripts/pricing/types';
import type { PriceHistory, VerificationFile } from '../src/lib/pricing-metadata';
import kimi from '../scripts/providers/kimi';
import glm from '../scripts/providers/glm';
import doubao from '../scripts/providers/doubao';
const now = '2026-09-13T00:00:00.000Z';
const models = [...additions.models, ...corrections.models].map(entry => modelSchema.parse(entry.model));
const snapshots = (providerId: ProviderId): RawPricingSnapshot => {
  const a = [kimi, glm, doubao].find(a => a.providerId === providerId)!;
  const ext = providerId === 'bytedance' ? 'json' : 'md';
  const body = readFileSync(`tests/fixtures/providers/${providerId}.${ext}`, 'utf8');
  return { providerId, url: a.sourceUrl, body, fetchedAt: now, sha256: hash(body) };
};
const initial = (catalog = fixtureCatalog) => {
  const history: PriceHistory = { schemaVersion: 1, models: catalog.models.map(model => ({ modelId: model.id, providerId: model.providerId, events: [{ id: hash(model.id), detectedAt: '2026-09-12T00:00:00.000Z', effectiveAt: null, currency: model.currency, rates: model.rates, sourceUrl: catalog.sources.find(s => s.id === model.sourceId)!.url, reason: 'initial_snapshot', verification: 'manual_verified', changeTypes: [] }] })) };
  const verified = { status: 'fresh' as const, lastCheckedAt: now, lastSuccessAt: now, verification: 'manual_verified' as const, reason: '测试用人工核验状态' };
  const verification: VerificationFile = { schemaVersion: 1, checkedAt: now, providers: {}, models: Object.fromEntries(catalog.models.map(model => [model.id, verified])), catalogHash: hash(meaningfulCatalog(catalog)) };
  return { catalog, history, verification };
};

test('Kimi 缓存未命中是标准输入，缓存命中和批量仍不能充当标准价', () => {
  const parsed = kimi.parse(snapshots('moonshot'), models.filter(m => m.providerId === 'moonshot'));
  assert.deepEqual(parsed.items[0].rates.map(r => [r.input, r.output, r.cacheRead]), [[20, 100, 2]]);
  const item = parsed.items[0];
  assert.equal(normalizedPriceSchema.safeParse(item).success, true);
  for (const inputLabel of ['输入价格（缓存命中）', 'cached input', 'Batch 输入价格（缓存未命中）', '输入价格（缓存未命中、缓存命中）']) {
    assert.equal(normalizedPriceSchema.safeParse({ ...item, evidence: { ...item.evidence, inputLabel } }).success, false);
  }
});

test('Kimi 结构、单位、币种改变或 MDX 表达式不允许静默取价', () => {
  const raw = snapshots('moonshot'), selected = models.filter(m => m.providerId === 'moonshot');
  for (const body of [raw.body.replace('输入价格（缓存未命中）', '批量输入价格'), raw.body.replace('rows={[', 'rows={(() => ['), '<div id="root"></div>']) {
    assert.throws(() => kimi.parse({ ...raw, body }, selected));
  }
  for (const body of [raw.body.replaceAll('1M tokens', '1K tokens'), raw.body.replaceAll('¥', '$')]) {
    assert.equal(kimi.parse({ ...raw, body }, selected).items.length, 0);
  }
});

test('豆包只读取方舟常规非音频价，拒绝扣子文档、低延迟、阶梯缺口和输出条件', () => {
  const raw = snapshots('bytedance'), selected = models.filter(m => m.providerId === 'bytedance');
  const parsed = doubao.parse(raw, selected);
  const mini = parsed.items.find(i => i.modelId === 'doubao-seed-2-0-mini')!;
  assert.deepEqual(mini.rates.map(r => [r.input, r.output, r.cacheRead]), [[.2, 2, .04], [.4, 4, .08], [.8, 8, .16]]);
  const wrong = JSON.parse(raw.body); wrong.Result.LibraryID = 84458;
  assert.throws(() => doubao.parse({ ...raw, body: JSON.stringify(wrong) }, selected));
  assert.throws(() => doubao.parse({ ...raw, body: raw.body.replaceAll('元/百万token', '元/千token') }, selected));
  for (const condition of ['输入长度 (33, 128]', '输入长度 [32, 128]', '输入长度 (32, 128] 且输出长度 [0, 200]']) {
    const body = raw.body.replaceAll('输入长度 (32, 128]', condition);
    assert.ok(doubao.parse({ ...raw, body }, selected).issues.some(issue => issue.modelId === mini.modelId));
  }
});

test('豆包最大输入、总上下文、输出上限和阶梯边界分别约束计算', () => {
  const model = models.find(m => m.id === 'doubao-seed-2-0-mini')!;
  assert.equal(quote(model, { ...defaultFilters, inputTokens: 32000 }, 7)!.input, .2);
  assert.equal(quote(model, { ...defaultFilters, inputTokens: 32001 }, 7)!.input, .4);
  assert.ok(quote(model, { ...defaultFilters, inputTokens: 224000, outputTokens: 1000 }, 7));
  assert.equal(quote(model, { ...defaultFilters, inputTokens: 224001, outputTokens: 0 }, 7), null);
  assert.equal(quote(model, { ...defaultFilters, inputTokens: 224000, outputTokens: 33000 }, 7), null);
  assert.equal(quote(model, { ...defaultFilters, outputTokens: 128001 }, 7), null);
});

test('智谱付费价与缓存存储优惠分离，免费模型和多档模型留给人工处理', () => {
  const raw = snapshots('zhipu');
  const parsed = glm.parse(raw, models.filter(m => m.providerId === 'zhipu'));
  const flagship = parsed.items.find(item => item.apiId === 'glm-5.3')!;
  assert.deepEqual(flagship.rates.map(r => [r.input, r.output, r.cacheRead]), [[8, 28, 2]]);
  assert.equal(parsed.items.length, 4);
  assert.match(parsed.issues.find(issue => issue.modelId === 'glm-4-7-flash')!.reason, /免费.*人工/);
  const tiered = { ...models.find(m => m.id === 'glm-5-3')!, apiId: 'glm-5.1' };
  assert.equal(glm.parse(raw, [tiered]).items.length, 0);
});

test('三家抓取失败继续保留价格和全部历史；智谱异常降价不会上线', () => {
  const catalog = catalogSchema.parse({ ...fixtureCatalog, meta: { ...fixtureCatalog.meta, updatedAt: '2026-09-12' }, sources: additions.sources, models });
  const current = initial(catalog);
  const failed = evaluateUpdates({ ...current, now, runs: [kimi, glm, doubao].map(a => ({ providerId: a.providerId, mode: 'automatic', checkedAt: now, error: '模拟 HTTP 500' })) });
  assert.equal(failed.dataChanged, false); assert.deepEqual(failed.history, current.history);
  const parsed = glm.parse(snapshots('zhipu'), models.filter(m => m.providerId === 'zhipu'));
  parsed.items.find(i => i.apiId === 'glm-5.3')!.rates[0].input = .01;
  parsed.items.find(i => i.apiId === 'glm-5.2')!.rates[0].input = 0;
  const changed = evaluateUpdates({ ...current, now, runs: [{ providerId: 'zhipu', mode: 'automatic', checkedAt: now, parsed }] });
  assert.equal(changed.dataChanged, false); assert.deepEqual(changed.history, current.history);
  assert.ok(changed.reviews.some(r => r.modelId === 'glm-5-3' && !r.approved));
  assert.ok(changed.reviews.some(r => r.modelId === 'glm-5-2' && r.status === 'blocked'));
});

test('新增 11 款模型追加历史、解除 Kimi 待收录状态，重复导入无变化', () => {
  const current = initial(), before = structuredClone(current);
  const next = addReviewedModels(current, additions, now);
  assert.equal(next.added.length, 11);
  assert.equal(next.catalog.providers.find(p => p.id === 'moonshot')!.pendingReason, null);
  assert.deepEqual(current, before); assert.deepEqual(next.history.models.slice(0, current.history.models.length), current.history.models);
  for (const id of next.added) assert.equal(stable(officialPrice(next.history.models.find(m => m.modelId === id)!.events[0])), stable(officialPrice(next.catalog.models.find(m => m.id === id)!)));
  const repeated = addReviewedModels(next, additions, now);
  assert.deepEqual(repeated.added, []); assert.deepEqual(repeated.history, next.history); assert.deepEqual(repeated.catalog, next.catalog);
});

test('未收录与未核验显示明确提示，普通空筛选和已核验厂商不误报', () => {
  const catalog = structuredClone(fixtureCatalog);
  const unknown = { status: 'unknown' as const, lastCheckedAt: now, lastSuccessAt: null, verification: 'unverified' as const, reason: '待核验' };
  catalog.models.filter(m => m.providerId === 'bytedance').forEach(m => m.verification = unknown);
  assert.equal(pendingPriceProviders(catalog, { ...defaultFilters, providers: ['moonshot'] }).length, 1);
  assert.match(renderPriceCoverage(catalog, { ...defaultFilters, providers: ['bytedance'] }, '/'), /豆包 · 价格待核验/);
  assert.equal(pendingPriceProviders(catalog, { ...defaultFilters, providers: ['bytedance'], query: '不存在的型号' }).length, 0);
  assert.equal(pendingPriceProviders(catalog, { ...defaultFilters, providers: ['openai'] }).length, 0);
  assert.equal(pendingPriceProviders(catalog, { ...defaultFilters, status: 'all' }).length, 0);
});
