import test from 'node:test';
import assert from 'node:assert/strict';
import data from '../src/data/pelican.json';
import { defaultPelicanFilters, getPelicanLeaders, getPelicanRows, getPelicanTier, getPelicanTiers, parsePelicanFilters, pelicanSchema, serializePelicanFilters } from '../src/lib/pelican';
import { renderPelicanLeaders, renderPelicanTiers } from '../src/lib/pelican-render';
import { catalog } from '../src/lib/catalog';

const example = { id: 'fixture-model', name: '测试模型', providerId: 'alibaba', tier: 'hang', order: 1, gif: 'media/pelican/fixture-model.gif' };

test('鹈鹕榜接受空数据，并校验当前录入内容', () => {
  assert.equal(pelicanSchema.parse({ schemaVersion: 1, entries: [] }).entries.length, 0);
  assert.doesNotThrow(() => pelicanSchema.parse(data));
});

test('鹈鹕榜优先按档位、同档按人工顺序排列，不修改原始数据', () => {
  const board = pelicanSchema.parse({ schemaVersion: 1, entries: [
    { ...example, id: 'fixture-low', tier: 'la' },
    { ...example, id: 'fixture-second', order: 2 },
    example,
  ] });
  const original = structuredClone(board);
  const tiers = getPelicanTiers(board);
  assert.deepEqual(tiers.map(tier => tier.id), ['hang', 'top', 'good', 'npc', 'la']);
  assert.deepEqual(tiers[0].entries.map(entry => entry.id), ['fixture-model', 'fixture-second']);
  assert.equal(tiers[4].entries[0].id, 'fixture-low');
  assert.deepEqual(tiers[1].entries, []);
  assert.deepEqual(board, original);
});

test('鹈鹕榜拒绝有歧义的顺序、未知档位和无效 GIF 路径', () => {
  const validate = (entries: unknown[]) => pelicanSchema.safeParse({ schemaVersion: 1, entries }).success;
  assert.equal(validate([example, { ...example, tier: 'la' }]), false, '重复测试 ID');
  assert.equal(validate([example, { ...example, id: 'other-model' }]), false, '同档排序重复');
  for (const patch of [
    { tier: 'unknown' }, { order: 0 }, { order: 1.5 }, { name: ' ' }, { providerId: 'unknown' },
    { gif: 'https://example.com/model.gif' }, { gif: 'media/pelican/../../model.gif' }, { gif: 'media/pelican/model.png' },
  ]) assert.equal(validate([{ ...example, ...patch }]), false, JSON.stringify(patch));
});

const board = pelicanSchema.parse({ schemaVersion: 1, entries: [
  { ...example, id: 'kimi-test', providerId: 'moonshot', name: 'Kimi K3', tier: 'top' },
  { ...example, id: 'gpt-lower', providerId: 'openai', name: 'GPT Lower', tier: 'la' },
  { ...example, id: 'gpt-test', providerId: 'openai', name: 'GPT Test', order: 2 },
  { ...example, id: 'qwen-test', name: 'Qwen Test' },
] });

test('厂商多选、中文厂商搜索和型号搜索只筛选测试数据，保留原档位与顺序', () => {
  const original = structuredClone(board);
  const selected = getPelicanRows(board, catalog, { ...defaultPelicanFilters, providers: ['openai', 'moonshot'] });
  assert.deepEqual(selected.map(entry => entry.id), ['gpt-test', 'kimi-test', 'gpt-lower']);
  assert.deepEqual(selected.map(getPelicanTier), ['hang', 'top', 'la']);
  assert.equal(getPelicanRows(board, catalog, { ...defaultPelicanFilters, query: '千问' })[0].id, 'qwen-test');
  assert.equal(getPelicanRows(board, catalog, { ...defaultPelicanFilters, query: 'kimi-k3' })[0].id, 'kimi-test');
  assert.equal(getPelicanRows(board, catalog, { ...defaultPelicanFilters, query: '未录入' }).length, 0);
  assert.equal(getPelicanRows(board, catalog, { ...defaultPelicanFilters, providers: ['openai'], query: 'Kimi' }).length, 0);
  assert.deepEqual(board, original);
});

test('倒序展示不改变前三名，同档按人工顺序选取；筛选后的前三名跟随筛选', () => {
  const rows = getPelicanRows(board, catalog, defaultPelicanFilters);
  const reversed = getPelicanRows(board, catalog, { ...defaultPelicanFilters, order: 'asc' });
  assert.deepEqual(reversed, [...rows].reverse());
  assert.deepEqual(getPelicanLeaders(rows).map(entry => entry.id), ['qwen-test', 'gpt-test', 'kimi-test']);
  assert.deepEqual(getPelicanLeaders(reversed), getPelicanLeaders(rows));
  const filtered = getPelicanRows(board, catalog, { ...defaultPelicanFilters, providers: ['openai'] });
  assert.deepEqual(getPelicanLeaders(filtered).map(entry => entry.id), ['gpt-test', 'gpt-lower']);
});

test('鹈鹕榜筛选 URL 能恢复搜索、厂商和方向，排除未知参数与重复厂商', () => {
  const filters = parsePelicanFilters('?providers=openai,unknown,moonshot,openai&order=asc&q=Kimi%20K3');
  assert.deepEqual(filters.providers, ['moonshot', 'openai']);
  assert.deepEqual(parsePelicanFilters(serializePelicanFilters(filters)), filters);
  assert.equal(serializePelicanFilters(defaultPelicanFilters), '');
  assert.equal(parsePelicanFilters('?order=bad').order, 'desc');
  assert.equal(parsePelicanFilters('?q=' + 'a'.repeat(200)).query.length, 100);
});

test('无正式数据时用状态卡，不足三名时不虚构额外名次', () => {
  const empty = renderPelicanLeaders([], catalog, '/', false);
  assert.equal((empty.match(/class="champion-card /g) ?? []).length, 3);
  for (const label of ['本次作品', '待原作核验', '正式上榜']) assert.ok(empty.includes(label));
  assert.doesNotMatch(empty, /<img|href=|fixture/);
  assert.doesNotMatch(empty, /第一名|第二名|第三名/);
  const partial = renderPelicanLeaders(board.entries.slice(0, 1), catalog, '/', true);
  assert.equal((partial.match(/class="champion-card /g) ?? []).length, 3);
  assert.equal((partial.match(/暂无更多独立名次/g) ?? []).length, 2);
});

test('等级列保持五档、支持反向展示，过滤后不输出数字名次或未选模型', () => {
  const rows = getPelicanRows(board, catalog, { ...defaultPelicanFilters, providers: ['openai'] });
  const html = renderPelicanTiers(rows, catalog, '/', 'desc');
  assert.deepEqual([...html.matchAll(/id="tier-([a-z]+)"/g)].map(match => match[1]), ['hang', 'top', 'good', 'npc', 'la']);
  assert.doesNotMatch(html, /rank-number|kimi-test|qwen-test/);
  assert.ok(html.includes('pelican-entry-gpt-test'));
  const reversed = renderPelicanTiers([...rows].reverse(), catalog, '/', 'asc');
  assert.deepEqual([...reversed.matchAll(/id="tier-([a-z]+)"/g)].map(match => match[1]), ['la', 'npc', 'good', 'top', 'hang']);
});

test('模型与 GIF 使用部署子路径和本地彩色 Logo，名称安全转义', () => {
  const rows = [{ ...board.entries[0], name: '<img src=x onerror=alert(1)>' }];
  for (const html of [renderPelicanLeaders(rows, catalog, '/model-prices/', true), renderPelicanTiers(rows, catalog, '/model-prices/', 'desc')]) {
    assert.match(html, /\/model-prices\/logos\/moonshot.svg/);
    assert.doesNotMatch(html, /<img src=x/);
    assert.match(html, /&lt;img src=x/);
  }
  const html = renderPelicanTiers(rows, catalog, '/model-prices/', 'desc');
  assert.match(html, /\/model-prices\/media\/pelican\/fixture-model.gif/);
  assert.match(html, /noopener noreferrer/);
});
