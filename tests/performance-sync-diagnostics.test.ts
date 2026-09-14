import test from 'node:test';
import assert from 'node:assert/strict';
import source from '../data/performance/initial-source.json';
import selectionData from './fixtures/performance/initial-selection.json';
import blankOrganization from './fixtures/performance/blank-organization.json';
import code from '../data/performance/arena-code-2026-09-11.json';
import { selectionSchema } from '../src/lib/performance-schema';
import { acceptSnapshot, normalizeArena } from '../scripts/performance/arena';
import { acceptCategorySnapshot, normalizeCategory } from '../scripts/performance/categories';
import { PerformanceReviewError } from '../scripts/performance/diagnostics';
import officialText from '../data/performance/arena-text-2026-09-11.json';
import expandedSelectionData from '../data/performance/models.json';
import { fetchArenaPage, normalizeArenaPage, parseArenaPageHtml } from '../scripts/performance/arena-page';
import { parseArenaImport } from '../scripts/performance/arena';

const selection = selectionSchema.parse(selectionData);
const now = '2026-09-14T00:00:00.000Z';
const previous = normalizeArena(source.rows, selection, now);

test('上游非收录型号的空 organization 不会阻断有效主流成绩，也不被猜成某厂商', () => {
  const candidate = normalizeArena([...source.rows, blankOrganization.row], selection, now);
  assert.deepEqual(candidate.models, previous.models);
  assert.equal(candidate.sourceRowCount, source.rows.length + 1, '仍计入完整上游行数');
  assert.equal(acceptSnapshot(previous, candidate), false, '只改变未收录来源行，不写空快照');
  assert.ok(!candidate.models.some(model => model.sourceModel === blankOrganization.row.model_name));
});

test('收录型号或未来主流系列缺组织仍拒绝，组织字段缺失或错误类型也不会被跳过', () => {
  assert.throws(() => normalizeArena([{ ...source.rows[0], organization: '  ' }, ...source.rows.slice(1)], selection, now), (error: unknown) => {
    assert.ok(error instanceof PerformanceReviewError);
    assert.equal(error.details.kind, 'missing_organization');
    assert.equal(error.details.sourceModel, source.rows[0].model_name);
    return true;
  });
  // Fictional future name tests the family guard; never written to live data.
  assert.throws(() => normalizeArena([...source.rows, { ...blankOrganization.row, model_name: 'gpt-99-high' }], { ...selection, includeProviderFamilies: true }, now), /缺少 organization/);
  for (const organization of [undefined, null, 123]) {
    assert.throws(() => normalizeArena([...source.rows, { ...blankOrganization.row, organization }], selection, now), /organization/);
  }
});

test('未收录的空组织行仍接受完整结构、分数、重复与统一日期校验', () => {
  for (const patch of [{ rating: 0 }, { leaderboard_publish_date: '2026-09-01' }, { model_name: source.rows[0].model_name }]) {
    assert.throws(() => normalizeArena([...source.rows, { ...blankOrganization.row, ...patch }], selection, now));
  }
});

test('文本删除告警列出全部缺失身份，不改动候选或已有快照', () => {
  const candidate = { ...previous, models: previous.models.slice(2) };
  const before = JSON.stringify([previous, candidate]);
  assert.throws(() => acceptSnapshot(previous, candidate), (error: unknown) => {
    assert.ok(error instanceof PerformanceReviewError);
    assert.match(error.message, /2 条/);
    assert.equal(error.details.previousCount, previous.models.length);
    assert.equal(error.details.candidateCount, candidate.models.length);
    assert.deepEqual(error.details.missingModels, previous.models.slice(0, 2).map(({ id, sourceModel, providerId }) => ({ id, sourceModel, providerId, sameSourceCandidates: [] })));
    return true;
  });
  assert.equal(JSON.stringify([previous, candidate]), before);
});

test('分类删除告警暴露同源异 ID 以定位映射问题，不自动接受身份变化', () => {
  const category = normalizeCategory(code, { ...selection, includeProviderFamilies: true }, now);
  const candidate = structuredClone(category);
  candidate.models[0].id = 'changed-test-identity';
  assert.throws(() => acceptCategorySnapshot(category, candidate), (error: unknown) => {
    assert.ok(error instanceof PerformanceReviewError);
    const missing = error.details.missingModels as { sameSourceCandidates: { id: string; providerId: string }[] }[];
    assert.deepEqual(missing[0].sameSourceCandidates, [{ id: 'changed-test-identity', providerId: category.models[0].providerId }]);
    return true;
  });
});

const textPage = {
  category:'text', sourceUrl:'https://arena.ai/leaderboard/text', publishedAt:officialText.publishedAt,
  sourceRowCount:officialText.sourceRowCount,
  headers:['Rank','Rank Spread','Model','Score','Votes','Price $/M','Context'],
  // A generated table fixture from reviewed official evidence, not captured DOM.
  rows:officialText.rows.map(row => [String(row.rank),`${row.rank} ${row.rank}`,`${row.model_name} ${row.organization} · test-license`,`${row.rating}±${row.uncertainty}${row.preliminary?' Preliminary':''}`,String(row.vote_count),'N/A','N/A']),
};

test('完整官网文本回退独立保留原榜精度与全部身份，不混用 API 或旧成绩', () => {
  const expanded = selectionSchema.parse(expandedSelectionData);
  const candidate = normalizeArenaPage(textPage, expanded, now);
  const imported = parseArenaImport(officialText);
  const reviewed = normalizeArena(imported.rows, expanded, now, imported.retrieval, imported.sourceUrl);
  assert.deepEqual(candidate.models, reviewed.models);
  assert.equal(candidate.retrieval,'official-page');
  assert.equal(candidate.sourceUrl,'https://arena.ai/leaderboard/text');
  assert.equal(acceptSnapshot(reviewed,candidate),false);
  assert.ok(candidate.models.some(model => model.sourceModel === 'gemini-3-flash (thinking-minimal)'));
});

test('官网文本回退仍拒绝不完整表、错位列、旧日期、已有型号丢失与错误厂商', () => {
  const expanded = selectionSchema.parse(expandedSelectionData);
  const previousPage = normalizeArenaPage(textPage, expanded, now);
  assert.throws(() => normalizeArenaPage({...textPage, rows:textPage.rows.slice(1)},expanded,now),/完整/);
  assert.throws(() => normalizeArenaPage({...textPage, headers:[...textPage.headers].reverse()},expanded,now),/表格列/);
  const older = normalizeArenaPage({...textPage,publishedAt:'2026-09-10'},expanded,now);
  assert.throws(() => acceptSnapshot(previousPage,older),/倒退/);
  const removed = structuredClone(textPage);
  const astra = removed.rows.findIndex(row => row[2].startsWith('gpt-6-astra-max '));
  removed.rows[astra][2] = 'unlisted-outside-model Outside · test-license';
  const incomplete = normalizeArenaPage(removed,expanded,now);
  assert.throws(() => acceptSnapshot(previousPage,incomplete),/删除.*gpt-6-astra-max/);
  const mismatched = structuredClone(textPage);
  mismatched.rows[0][2] = mismatched.rows[0][2].replace('Anthropic','OpenAI');
  assert.throws(() => normalizeArenaPage(mismatched,expanded,now),/厂商不匹配/);
});

test('文本官网 HTTP 读取完整表，403/残缺 HTML 仍失败而非产生空候选', async () => {
  const one = {...textPage,sourceRowCount:1,rows:[textPage.rows[0]]};
  const html = `<h1>Text Arena</h1><p>Sep 11, 2026</p><p>1 models</p><table><thead><tr>${one.headers.map(cell=>`<th>${cell}</th>`).join('')}</tr></thead><tbody><tr>${one.rows[0].map(cell=>`<td>${cell}</td>`).join('')}</tr></tbody></table>`;
  assert.deepEqual(parseArenaPageHtml(html),one);
  assert.deepEqual(await fetchArenaPage(async(input) => {
    assert.equal(String(input),'https://arena.ai/leaderboard/text');
    return new Response(html);
  }),one);
  await assert.rejects(fetchArenaPage(async()=>new Response('blocked',{status:403})),/403/);
  assert.throws(() => parseArenaPageHtml(html.replace('1 models','2 models')),/完整/);
  assert.throws(() => parseArenaPageHtml('<h1>unavailable</h1>'),/结构/);
});
