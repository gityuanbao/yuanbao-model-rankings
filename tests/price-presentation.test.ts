import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFragment } from 'parse5';
import { fixtureCatalog } from './fixtures/catalog';
import { defaultFilters, getRows, money, type Filters } from '../src/lib/ranking';
import { renderChampions, renderMobileRows } from '../src/lib/render';
import type { Model } from '../src/lib/schema';

function textContent(html: string): string {
  const read = (node: any): string => node.nodeName === '#text' ? node.value : (node.childNodes ?? []).map(read).join(' ');
  return read(parseFragment(html));
}
function setup(id: string, patch: Partial<Filters> = {}) {
  const catalog = structuredClone(fixtureCatalog);
  catalog.models = catalog.models.filter(model => model.id === id);
  const filters = { ...defaultFilters, ...patch };
  return { catalog, filters, model: catalog.models[0] };
}
function verification(status: NonNullable<Model['verification']>['status']): NonNullable<Model['verification']> {
  const now = new Date().toISOString();
  return { status, lastCheckedAt: now, lastSuccessAt: now, verification: 'manual_verified', reason: '测试核验状态' };
}

test('仅存量与旧价提示在冠军和手机折叠区外可见，展开后保留完整状态及核验信息', () => {
  const { catalog, filters, model } = setup('hunyuan-a13b');
  model.status = 'deprecated';
  model.verification = verification('stale');
  const rows = getRows(catalog, filters).rows;
  const mobile = renderMobileRows(rows, catalog, filters, '/');
  const preview = textContent(mobile.split('<details>')[0]);
  assert.match(preview, /仅存量/);
  assert.match(preview, /沿用旧价/);
  assert.match(textContent(mobile), /模型状态.*仅存量 \/ 即将下架/);
  assert.match(textContent(mobile), /最后核验.*保留上次有效价/);
  const champions = textContent(renderChampions(rows, catalog, filters, '/'));
  assert.equal((champions.match(/仅存量/g) ?? []).length, 3);
  assert.equal((champions.match(/沿用旧价/g) ?? []).length, 3);
});

test('待审核和未核验状态不会被冠军或手机默认卡片省略，正常核验不添加异常提示', () => {
  const { catalog, filters, model } = setup('qwen-flash', { status: 'all' });
  for (const [status, label] of [['manual_review', '变价待审核'], ['unknown', '价格未核验']] as const) {
    model.verification = verification(status);
    const rows = getRows(catalog, filters).rows;
    assert.ok(textContent(renderMobileRows(rows, catalog, filters, '/').split('<details>')[0]).includes(label));
    assert.ok(textContent(renderChampions(rows, catalog, filters, '/')).includes(label));
  }
  model.verification = verification('fresh');
  const rows = getRows(catalog, filters).rows;
  assert.doesNotMatch(renderMobileRows(rows, catalog, filters, '/').split('<details>')[0], /沿用旧价|变价待审核|价格未核验|超过 7 天/);
});

test('手机完整费率说明实际采用的优惠及回退结果，保留每百万和每次单位', () => {
  const cached = setup('glm-4-7-flashx', { billing: 'cache', cachePercent: 50 });
  const cachedRows = getRows(cached.catalog, cached.filters).rows;
  const cachedText = textContent(renderMobileRows(cachedRows, cached.catalog, cached.filters, '/'));
  assert.match(cachedText, /当前计费.*缓存输入（命中 50%）/);
  assert.ok(cachedText.includes(`¥${money(cachedRows[0].input)} / 百万 Token`));
  assert.ok(cachedText.includes(`¥${money(cachedRows[0].task, true)} / 次`));
  const fallback = setup('qwen-flash', { billing: 'cache' });
  const fallbackText = textContent(renderMobileRows(getRows(fallback.catalog, fallback.filters).rows, fallback.catalog, fallback.filters, '/'));
  assert.match(fallbackText, /当前计费.*标准费率（所选优惠未适用）/);
  assert.doesNotMatch(fallbackText, /当前计费.*缓存输入/);
});

test('手机费率档位跟随实际输入越过阶梯边界，任务名称不再保留标准任务歧义', () => {
  const { catalog, filters } = setup('qwen3-7-flash', { scenario: 'custom', inputTokens: 32001 });
  const text = textContent(renderMobileRows(getRows(catalog, filters).rows, catalog, filters, '/'));
  assert.match(text, /本次适用档位.*32,000 < 输入 ≤ 256,000 Token（阶梯计费）/);
  assert.match(text, /输入价格.*¥0\.60 \/ 百万 Token/);
  assert.match(text, /任务成本/);
  assert.doesNotMatch(text, /标准任务成本/);
});
