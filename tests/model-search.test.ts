import test from 'node:test';
import assert from 'node:assert/strict';
import { catalog } from '../src/lib/catalog';
import { performanceBoards } from '../src/lib/performance-data';
import { defaultFilters, getRows } from '../src/lib/ranking';
import { defaultPerformanceFilters, getPerformanceRows } from '../src/lib/performance';
import { defaultPelicanFilters, getPelicanRows, pelicanSchema } from '../src/lib/pelican';
import { modelSearch } from '../src/lib/search';

test('价格搜索接受空格和版本标点，GPT 6 不误命中 GPT-5.6', () => {
  const ids = (query: string) => getRows(catalog, { ...defaultFilters, query }).rows.map(row => row.model.id);
  assert.deepEqual(ids('GLM 5.3'), ids('GLM-5.3'));
  assert.ok(ids('GLM 5.3').includes('glm-5-3'));
  assert.deepEqual(ids('GPT 6'), ['gpt-6-astra']);
  assert.deepEqual(ids('ＧＰＴ－６　Astra'), ['gpt-6-astra']);
  assert.deepEqual(ids('OpenAI GPT 6'), ['gpt-6-astra']);
});

test('性能搜索同时匹配显示名称、括号内配置和厂商，不受字段顺序影响', () => {
  for (const category of ['text', 'code', 'agent'] as const) {
    for (const query of ['GPT-6 Astra Max', 'GPT 6 Astra (Max)', 'ＧＰＴ—６ Astra（Max）', 'Max OpenAI GPT 6']) {
      const rows = getPerformanceRows(performanceBoards[category], catalog, { ...defaultPerformanceFilters, category, query });
      assert.equal(rows.length, 1, `${category}: ${query}`);
      assert.equal(rows[0].name, 'GPT-6 Astra');
      assert.equal(rows[0].mode, 'Max');
    }
  }
});

test('鹈鹕采用相同搜索规则，型号和厂商可以组合查询', () => {
  const board = pelicanSchema.parse({ schemaVersion: 1, entries: [
    { id: 'gpt-test', name: 'GPT-6 Astra（Max）', providerId: 'openai', tier: 'top', order: 1, gif: 'media/pelican/gpt-test.gif' },
    { id: 'glm-test', name: 'GLM-5.3', providerId: 'zhipu', tier: 'top', order: 2, gif: 'media/pelican/glm-test.gif' },
  ] });
  const ids = (query: string) => getPelicanRows(board, catalog, { ...defaultPelicanFilters, query }).map(row => row.id);
  assert.deepEqual(ids('GPT 6 Astra Max'), ['gpt-test']);
  assert.deepEqual(ids('智谱 GLM 5.3'), ['glm-test']);
  assert.deepEqual(ids('GPT 6 智谱'), []);
});

test('跨字段模式匹配不依赖原始型号已经拼入配置，也不把未满足的词当作命中', () => {
  const fields = ['GPT-6 Astra', 'Max', 'some-official-id', 'OpenAI'];
  assert.equal(modelSearch('GPT-6-Astra-(Max)')(...fields), true);
  assert.equal(modelSearch('GPT 6 High')(...fields), false);
  assert.equal(modelSearch('GPT 6')('GPT-5.6', 'OpenAI'), false);
  assert.equal(modelSearch('')(...fields), true);
});
