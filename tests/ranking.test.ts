import test from 'node:test';
import assert from 'node:assert/strict';
import { fixtureCatalog as catalog } from './fixtures/catalog';
import { catalogSchema, type Model } from '../src/lib/schema';
import { defaultFilters, getRows, money, quote, rankRows, type Filters } from '../src/lib/ranking';
import { parseFilters, serializeFilters } from '../src/lib/url-state';
import { escapeHtml, modelUrl, renderChampions } from '../src/lib/render';

const filters = (patch: Partial<Filters> = {}): Filters => ({ ...defaultFilters, providers: [], ...patch });
const model = (id: string) => catalog.models.find(model => model.id === id)!;
test('极小的非零任务费用不能被展示为免费', () => {
  assert.equal(money(.00000015, true), '0.00000015');
  assert.notEqual(money(1e-12, true), '0.00');
});
test('默认值按标准费率计算，百万 Token 换算正确', () => {
  const value = quote(model('qwen-flash'), filters(), 7)!;
  assert.equal(value.input, .15); assert.equal(value.output, 1.5); assert.equal(value.task, .00165); assert.equal(value.applied, 'standard');
});
test('保留美元原价并统一折算人民币', () => {
  const value = quote(model('gpt-5-6-luna'), filters(), 7)!;
  assert.ok(Math.abs(value.input - 1.4) < 1e-10); assert.ok(Math.abs(value.task - .0098) < 1e-10);
  assert.equal(model('gpt-5-6-luna').rates[0].input, .2);
});
test('输入阶梯边界属于前一档，越界后整次请求进入下一档', () => {
  const item = model('qwen3-7-flash');
  assert.equal(quote(item, filters({ inputTokens: 32000 }), 7)!.input, .2);
  const next = quote(item, filters({ inputTokens: 32001 }), 7)!;
  assert.equal(next.input, .6); assert.equal(next.output, 2.4);
  assert.equal(next.task, (32001 * .6 + 1000 * 2.4) / 1e6);
});
test('缓存命中比例为 0、50、100 时分别使用标准、混合、读取费率', () => {
  const item = model('glm-4-7-flashx');
  assert.equal(quote(item, filters({ billing: 'cache', cachePercent: 0 }), 7)!.input, .5);
  assert.equal(quote(item, filters({ billing: 'cache', cachePercent: 50 }), 7)!.input, .3);
  assert.equal(quote(item, filters({ billing: 'cache', cachePercent: 100 }), 7)!.input, .1);
  assert.equal(quote(item, filters({ billing: 'cache', cachePercent: 100 }), 7)!.output, 3);
});
test('未知缓存读取价保留 null，并回退标准价', () => {
  const value = quote(model('qwen-flash'), filters({ billing: 'cache', cachePercent: 100 }), 7)!;
  assert.equal(value.cache, null); assert.equal(value.input, .15); assert.equal(value.applied, 'standard');
});
test('Batch 只有显式启用才计算，不叠加缓存', () => {
  const item = model('claude-sonnet-5');
  assert.equal(quote(item, filters(), 1)!.task, .012);
  const value = quote(item, filters({ billing: 'batch', cachePercent: 100 }), 1)!;
  assert.equal(value.input, 1); assert.equal(value.output, 5); assert.equal(value.task, .006);
});
test('低峰优惠只对支持模型显式应用', () => {
  assert.equal(quote(model('deepseek-flash'), filters({ billing: 'offpeak' }), 1)!.input, .15);
  assert.equal(quote(model('deepseek-flash'), filters(), 1)!.input, .3);
  assert.equal(quote(model('qwen-flash'), filters({ billing: 'offpeak' }), 1)!.input, .15);
});
test('促销有有效期，未开始和过期不纳入；默认不含促销', () => {
  const item: Model = structuredClone(model('qwen-flash'));
  item.rates[0].promotion = { factor: .5, startsAt: '2026-09-01', endsAt: '2026-09-12', note: '测试专用' };
  assert.equal(quote(item, filters(), 1, '2026-09-12')!.input, .15);
  assert.equal(quote(item, filters({ billing: 'promotion' }), 1, '2026-09-12')!.input, .075);
  assert.equal(quote(item, filters({ billing: 'promotion' }), 1, '2026-09-13')!.input, .15);
  assert.equal(quote(item, filters({ billing: 'promotion' }), 1, '2026-08-31')!.input, .15);
});
test('上下文、输出限制、未核验长输入费率均不可虚报成本', () => {
  assert.equal(quote(model('ernie-4-5-turbo-32k'), filters({ inputTokens: 32000, outputTokens: 1 }), 7), null);
  assert.equal(quote(model('gpt-5-6-luna'), filters({ outputTokens: 128001 }), 7), null);
  assert.equal(quote(model('grok-4-6'), filters({ inputTokens: 200001 }), 7), null);
});
test('独立输入限制的模型不将输出错误计入输入窗口', () => {
  assert.notEqual(quote(model('gemini-2-5-flash-lite'), filters({ inputTokens: 1048576, outputTokens: 1 }), 7), null);
});
test('非法 Token 数不进入计费公式', () => {
  for (const inputTokens of [-1, .5, NaN, Infinity]) assert.equal(quote(model('qwen-flash'), filters({ inputTokens }), 7), null);
});
test('并列使用 1、1、3，基准倍数正确', () => {
  const subset = { ...catalog, models: [model('doubao-seed-2-0-mini'), model('qwen3-7-flash'), model('qwen3-max')] };
  const { rows } = getRows(subset, filters());
  assert.deepEqual(rows.map(row => row.rank), [1, 1, 3]);
  assert.deepEqual(rows.map(row => row.tied), [true, true, false]);
  assert.deepEqual(rows.map(row => row.ratio), [1, 1, 12.5]);
});
test('免费记录保留原价和出处，但不进入排行榜及最低价基准', () => {
  const { rows } = getRows(catalog, filters());
  assert.ok(rows.every(row => row.input > 0 && row.output > 0));
  assert.equal(rows[0].ratio, 1);
  assert.ok(rows.every(row => row.ratio !== null && row.ratio >= 1));
  assert.equal(quote(model('glm-4-7-flash'), filters(), 7)!.input, 0);
  assert.ok(model('glm-4-7-flash').zeroPriceReason);
});
test('标准任务按真实 Token 配比排序，浮点同价正确并列', () => {
  const subset = { ...catalog, models: [model('gemini-2-5-flash-lite'), model('glm-4-7-flashx'), model('qwen3-8-flash')] };
  const { rows } = getRows(subset, filters({ metric: 'task' }));
  assert.deepEqual(rows.map(row => row.rank), [1, 1, 1]);
  const outputRows = rankRows(getRows(catalog, filters()).rows, 'output');
  assert.equal(outputRows[0].model.id, 'qwen3-7-flash');
});
test('默认隐藏下架记录，但可显式查看且历史 URL 稳定', () => {
  assert.ok(!getRows(catalog, filters()).rows.some(row => row.model.status === 'retired'));
  const retired = getRows(catalog, filters({ status: 'retired' })).rows;
  assert.equal(retired.length, 1); assert.equal(retired[0].model.id, 'claude-sonnet-4');
  assert.equal(modelUrl('/model-prices/', retired[0].model.id), '/model-prices/models/claude-sonnet-4/');
});
test('六类筛选组合生效，上下文未知不冒充满足条件', () => {
  const { rows } = getRows(catalog, filters({ providers: ['alibaba'], maxPrice: .3, minContext: 1000000, status: 'active', region: 'mainland', useCase: 'code' }));
  assert.deepEqual(new Set(rows.map(row => row.model.id)), new Set(['qwen-flash', 'qwen3-7-flash']));
  assert.equal(getRows(catalog, filters({ providers: ['tencent'], minContext: 1 })).rows.length, 0);
});
test('零上限和无结果不会错误回退成全榜', () => {
  assert.equal(getRows(catalog, filters({ maxPrice: 0 })).rows.length, 0);
  assert.equal(getRows(catalog, filters({ providers: ['moonshot'] })).rows.length, 0);
  assert.equal(getRows(catalog, filters({ query: '不存在的模型' })).rows.length, 0);
});
test('URL 完整往返，包含自定义参数、多厂商、优惠和零上限', () => {
  const original = filters({ metric: 'task', providers: ['alibaba', 'google'], maxPrice: 0, minContext: 333333, status: 'preview', region: 'singapore', useCase: 'long', scenario: 'custom', inputTokens: 0, outputTokens: 5000, billing: 'cache', cachePercent: 0, query: '千问 &' });
  assert.deepEqual(parseFilters(serializeFilters(original)), original);
  assert.equal(serializeFilters(filters()), '');
});
test('URL 非法值、伪厂商、Infinity、负数和多余参数被安全忽略', () => {
  const parsed = parseFilters('?rank=hack&providers=google,evil,google&max=Infinity&context=-2&in=-5&out=NaN&scenario=custom&billing=hack&hit=101');
  assert.equal(parsed.metric, 'input'); assert.deepEqual(parsed.providers, ['google']); assert.equal(parsed.maxPrice, null);
  assert.equal(parsed.inputTokens, 1000); assert.equal(parsed.outputTokens, 1000); assert.equal(parsed.cachePercent, 50);
});
test('场景预设重新加载时正确恢复，恶意 in 参数不覆盖预设', () => {
  const parsed = parseFilters('?scenario=long&in=999999');
  assert.equal(parsed.inputTokens, 32000); assert.equal(parsed.outputTokens, 2000);
});
test('所有并列冠军都可访问，输出内容转义', () => {
  const subset = { ...catalog, models: [model('doubao-seed-2-0-mini'), model('qwen3-7-flash')] };
  const html = renderChampions(getRows(subset, filters()).rows, subset, filters(), '/');
  assert.match(html, /查看其他并列冠军/);
  assert.match(html, /models\/doubao-seed-2-0-mini/); assert.match(html, /models\/qwen3-7-flash/);
  assert.equal(escapeHtml('<script>"&'), '&lt;script&gt;&quot;&amp;');
});
test('数据校验拒绝第三方价格源、重复 ID、负价与无依据零价', () => {
  for (const mutate of [
    (data: typeof catalog) => { data.sources[0].url = 'https://openai.com.attacker.example/pricing'; },
    (data: typeof catalog) => { data.models[1].id = data.models[0].id; },
    (data: typeof catalog) => { data.models[0].rates[0].input = -1; },
    (data: typeof catalog) => { data.models[0].rates[0].input = 0; },
    (data: typeof catalog) => { data.models[0].verifiedAt = '2026-02-30'; },
  ]) { const data = structuredClone(catalog); mutate(data); assert.equal(catalogSchema.safeParse(data).success, false); }
});

test('零价在全部排序、厂商筛选与计费模式中隐藏，冠军卡片不再显示免费型号',()=>{
  for(const metric of ['input','output','task'] as const)for(const order of ['asc','desc'] as const)for(const billing of ['standard','cache','batch','offpeak','promotion'] as const){
    const state=filters({metric,order,billing,providers:['zhipu'],status:'all'});
    const rows=getRows(catalog,state).rows;
    assert.ok(rows.every(row=>row.input>0 && row.output>0));
    assert.ok(!rows.some(row=>row.model.id==='glm-4-7-flash'));
    assert.ok(!renderChampions(rows,catalog,state,'/').includes('models/glm-4-7-flash/'));
  }
});
test('单边零价、阶梯零价与有效零价优惠隐藏；未使用的免费缓存及零 Token 不误删付费模型',()=>{
  const original=model('qwen3-7-flash');
  for(const side of ['input','output'] as const){
    const item=structuredClone(original);item.rates[0][side]=0;
    const data={...catalog,models:[item]};
    assert.equal(getRows(data,filters()).rows.length,0);
    assert.equal(getRows(data,filters({inputTokens:32001})).rows.length,1);
  }
  const item=structuredClone(original);item.rates[0].cacheRead=0;
  const data={...catalog,models:[item]};
  assert.equal(getRows(data,filters()).rows.length,1);
  assert.equal(getRows(data,filters({billing:'cache',cachePercent:100})).rows.length,0);
  const rows=getRows(data,filters({metric:'task',inputTokens:0,outputTokens:0})).rows;
  assert.equal(rows.length,1);assert.equal(rows[0].task,0);assert.equal(rows[0].ratio,1);
});
