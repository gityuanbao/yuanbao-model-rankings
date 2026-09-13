import test from 'node:test';
import assert from 'node:assert/strict';
import { fixtureCatalog as catalog } from './fixtures/catalog';
import { defaultFilters, getRows, type Metric } from '../src/lib/ranking';
import { parseFilters, serializeFilters } from '../src/lib/url-state';
import { modelUrl, renderChampions, renderRows, renderMobileRows, renderTableHead } from '../src/lib/render';

for (const metric of ['input', 'output', 'task'] as Metric[]) {
  test(`${metric} 支持升降序，同时保留价格排名、并列与最低价倍数`, () => {
    const asc = getRows(catalog, { ...defaultFilters, metric }).rows;
    const desc = getRows(catalog, { ...defaultFilters, metric, order: 'desc' }).rows;
    assert.equal(asc.length, desc.length);
    assert.deepEqual(new Set(asc.map(row => row.model.id)), new Set(desc.map(row => row.model.id)));
    assert.ok(asc.every((row, i) => !i || row[metric] >= asc[i - 1][metric] - 1e-12));
    assert.ok(desc.every((row, i) => !i || row[metric] <= desc[i - 1][metric] + 1e-12));
    for (const row of desc) {
      assert.deepEqual(row, asc.find(original => original.model.id === row.model.id));
    }
    // Tied models use the same deterministic order in both directions.
    for (const rank of new Set(asc.map(row => row.rank))) {
      assert.deepEqual(desc.filter(row => row.rank === rank).map(row => row.model.id), asc.filter(row => row.rank === rank).map(row => row.model.id));
    }
    const settings = { ...defaultFilters, metric, order: 'desc' as const };
    assert.equal(renderChampions(desc, catalog, settings, '/'), renderChampions(asc, catalog, settings, '/'));
    assert.match(renderTableHead(metric, 'desc'), /aria-sort="descending"/);
    assert.doesNotMatch(renderTableHead(metric, 'desc'), /aria-sort="ascending"/);
    assert.match(renderTableHead(metric, 'asc'), /aria-sort="ascending"/);
  });
}
test('排序与搜索、厂商、任务参数一起往返 URL 和详情链接', () => {
  const filters = { ...defaultFilters, metric: 'task' as const, order: 'desc' as const, providers: ['alibaba'], scenario: 'custom' as const, inputTokens: 1234, outputTokens: 0, query: 'Qwen' };
  const query = serializeFilters(filters);
  assert.deepEqual(parseFilters(query), filters);
  assert.equal(serializeFilters(defaultFilters), '');
  assert.equal(parseFilters('?order=hack').order, 'asc');
  assert.equal(parseFilters('?order=desc').order, 'desc');
  assert.equal(modelUrl('/model-prices/', 'qwen-flash', filters), `/model-prices/models/qwen-flash/${query}`);
  const rows = getRows(catalog, filters).rows;
  assert.ok(rows.length > 0);
  assert.match(renderRows(rows, catalog, filters, '/model-prices/'), /order=desc/);
  assert.match(renderMobileRows(rows, catalog, filters, '/model-prices/'), /order=desc/);
});
test('降序保留付费最低价基准，零价与零上限均不产生结果', () => {
  const filters = { ...defaultFilters, order: 'desc' as const };
  const rows = getRows(catalog, filters).rows;
  assert.ok(rows.at(-1)!.input > 0);
  assert.equal(rows.at(-1)!.ratio, 1);
  assert.ok(rows[0].ratio! >= 1);
  const capped = getRows(catalog, { ...filters, maxPrice: .3 }).rows;
  assert.ok(capped.every(row => row.input <= .3));
  assert.equal(getRows(catalog, { ...filters, maxPrice: 0 }).rows.length, 0);
  assert.deepEqual(getRows(catalog, { ...filters, query: 'does-not-exist' }).rows, []);
});
