import test from 'node:test';
import assert from 'node:assert/strict';
import { catalog } from '../src/lib/catalog';
import { defaultPelicanFilters, getPelicanCounts, getPelicanLeaders, getPelicanRankGroups, getPelicanRows, getPelicanScore, getPelicanTier, getPelicanTiers, pelicanCriteria, pelicanPrompt, pelicanSchema, pelicanV3EntrySchema, type PelicanV3Entry } from '../src/lib/pelican';
import { renderPelicanLeaders, renderPelicanTiers } from '../src/lib/pelican-render';

function sample(id = 'sample-cat', status: 'provisional' | 'verified' = 'provisional'): PelicanV3Entry {
  return {
    id, name: `白猫 ${id}`, providerId: 'openai', ruleVersion: '3.0',
    media: { type: 'video', src: `media/pelican/${id}.mp4`, poster: `media/pelican/${id}.webp`, width: 1000, height: 750 },
    test: { modelLabel: `测试型号 ${id}`, platform: status === 'verified' ? '测试平台' : null, effort: status === 'verified' ? '最高' : null, date: status === 'verified' ? '2026-09-14' : null, tools: status === 'verified' ? 'none' : 'unknown', codeModified: status === 'verified' ? false : null, identityStatus: status === 'verified' ? 'verified' : 'submitted', firstAttempt: status === 'verified' ? true : null, promptStatus: status === 'verified' ? 'exact' : 'unknown', promptText: status === 'verified' ? pelicanPrompt : null, notes: [] },
    assessment: { status, reviewedAt: '2026-09-14', reviewer: 'AI', ownerConfirmed: status === 'verified', criteria: pelicanCriteria.map(criterion => ({ id: criterion.id, score: criterion.kind === 'technical' && status === 'provisional' ? null : criterion.maximum, reason: criterion.kind === 'technical' && status === 'provisional' ? '缺少原始 HTML，待核验' : '可见画面满足对应要求', evidenceTimes: criterion.kind === 'visual' ? [0, 1.5] : [] })) },
  };
}
const boardOf = (entries: PelicanV3Entry[]) => pelicanSchema.parse({ schemaVersion: 2, ruleVersion: '3.0', entries });

function scored(id: string, total: number) {
  const entry = sample(id, 'verified');
  let remaining = total;
  for (const item of entry.assessment.criteria) {
    const maximum = pelicanCriteria.find(criterion => criterion.id === item.id)!.maximum;
    item.score = Math.min(remaining, maximum);
    remaining -= item.score;
  }
  assert.equal(remaining, 0);
  return pelicanV3EntrySchema.parse(entry);
}

test('v3 observation is 90 visual points plus unknown technical points, never a zero or a rescaled 100', () => {
  const entry = pelicanV3EntrySchema.parse(sample());
  assert.deepEqual(getPelicanScore(entry), { visual: 90, visualCompleted: 9, total: null });
  assert.equal(getPelicanTier(entry), null);
  assert.deepEqual(getPelicanCounts([entry]), { total: 1, provisional: 1, verified: 0 });
  assert.deepEqual(getPelicanLeaders([entry]), []);
  assert.ok(getPelicanTiers(boardOf([entry])).every(tier => tier.entries.length === 0));
  const html = renderPelicanTiers([entry], catalog, '/', 'desc');
  assert.match(html, /画面观察分 90 \/ 90/);
  assert.match(html, /网页与 SVG 10 分待核验/);
  assert.doesNotMatch(html, /正式成绩 90|100 分|0 \/ 5/);
});

test('v3 rejects missing, repeated, fabricated, fractional or prematurely completed criteria', () => {
  for (const mutate of [
    (entry: PelicanV3Entry) => { entry.assessment.criteria.pop(); },
    (entry: PelicanV3Entry) => { entry.assessment.criteria[1].id = entry.assessment.criteria[0].id; },
    (entry: PelicanV3Entry) => { entry.assessment.criteria[0].score = 7; },
    (entry: PelicanV3Entry) => { entry.assessment.criteria[0].score = 11; },
    (entry: PelicanV3Entry) => { entry.assessment.criteria[0].score = Number.NaN; },
    (entry: PelicanV3Entry) => { entry.assessment.criteria[0].reason = ' '; },
    (entry: PelicanV3Entry) => { entry.assessment.criteria[0].evidenceTimes = [-1]; },
    (entry: PelicanV3Entry) => { entry.assessment.criteria[9].score = 0; },
    (entry: PelicanV3Entry) => { entry.assessment.criteria[10].score = 5; },
  ]) {
    const entry = sample(); mutate(entry);
    assert.equal(pelicanV3EntrySchema.safeParse(entry).success, false);
  }
  assert.equal(pelicanV3EntrySchema.safeParse({ ...sample(), tier: 'hang', total: 100 }).success, false);
  assert.equal(pelicanSchema.safeParse({ schemaVersion: 2, ruleVersion: '2.0', entries: [sample()] }).success, false);
  assert.equal(pelicanSchema.safeParse({ schemaVersion: 2, ruleVersion: '3.0', entries: [sample(), sample()] }).success, false);
});

test('invisible visual evidence stays unknown without being assigned zero', () => {
  const entry = sample(); entry.assessment.criteria[6].score = null;
  assert.deepEqual(getPelicanScore(pelicanV3EntrySchema.parse(entry)), { visual: null, visualCompleted: 8, total: null });
  const html = renderPelicanTiers([entry], catalog, '/', 'desc');
  assert.match(html, /画面观察待补充 · 已完成 8 \/ 9 项/);
  assert.doesNotMatch(html, /画面观察分 80/);
});

test('formal publication requires complete scoring, original conditions, same prompt and owner review', () => {
  assert.doesNotThrow(() => pelicanV3EntrySchema.parse(sample('formal', 'verified')));
  const mutations: Array<(entry: PelicanV3Entry) => void> = [
    entry => { entry.assessment.ownerConfirmed = false; },
    entry => { entry.assessment.criteria[10].score = null; },
    entry => { entry.test.identityStatus = 'submitted'; },
    entry => { entry.test.platform = null; },
    entry => { entry.test.effort = null; },
    entry => { entry.test.date = null; },
    entry => { entry.test.tools = 'unknown'; },
    entry => { entry.test.codeModified = true; },
    entry => { entry.test.firstAttempt = null; },
    entry => { entry.test.firstAttempt = false; },
    entry => { entry.test.promptStatus = 'unknown'; },
    entry => { entry.test.promptStatus = 'variant'; entry.test.promptText = '做一个白色猫咪骑自行车的html网页，用svg绘制'; },
  ];
  for (const mutate of mutations) {
    const entry = sample('formal', 'verified'); mutate(entry);
    assert.equal(pelicanV3EntrySchema.safeParse(entry).success, false);
  }
  const variant = sample(); variant.test.promptStatus = 'variant';
  assert.equal(pelicanV3EntrySchema.safeParse(variant).success, false);
  variant.test.promptText = '做一个白色猫咪骑自行车的html网页，用svg绘制';
  assert.equal(pelicanV3EntrySchema.safeParse(variant).success, true);
  variant.test.promptStatus = 'exact';
  assert.equal(pelicanV3EntrySchema.safeParse(variant).success, false);
});

test('record dates and local media identifiers are checked before a record can be used', () => {
  for (const mutate of [
    (entry: PelicanV3Entry) => { entry.media.src = 'https://example.com/a.mp4'; },
    (entry: PelicanV3Entry) => { entry.media.src = 'media/pelican/other.mp4'; },
    (entry: PelicanV3Entry) => { entry.media.poster = 'media/pelican/../other.webp'; },
    (entry: PelicanV3Entry) => { entry.media.width = 0; },
    (entry: PelicanV3Entry) => { entry.test.date = '2026-02-30'; },
    (entry: PelicanV3Entry) => { entry.assessment.reviewedAt = '2026-13-01'; },
  ]) {
    const entry = sample(); mutate(entry);
    assert.equal(pelicanV3EntrySchema.safeParse(entry).success, false);
  }
});

test('formal tiers are derived from the complete score with no former animation caps', () => {
  for (const [total, tier] of [[100, 'hang'], [90, 'hang'], [85, 'top'], [75, 'top'], [60, 'good'], [40, 'npc'], [0, 'la']] as const) {
    const entry = scored('fixture', total);
    assert.equal(getPelicanScore(entry).total, total);
    assert.equal(getPelicanTier(entry), tier);
  }
  const half = scored('half-point', 100); half.assessment.criteria[10].score = 2.5;
  assert.equal(getPelicanScore(pelicanV3EntrySchema.parse(half)).total, 97.5);
});

test('provisional entries retain submitted order in both directions while filtering works across record labels', () => {
  const first = sample('first'); first.test.modelLabel = 'GPT Original';
  const second = sample('second'); second.providerId = 'moonshot';
  second.name = 'Kimi 测试';
  const board = boardOf([first, second]);
  const original = structuredClone(board);
  for (const order of ['desc', 'asc'] as const) assert.deepEqual(getPelicanRows(board, catalog, { ...defaultPelicanFilters, order }).map(entry => entry.id), ['first', 'second']);
  assert.deepEqual(getPelicanRows(board, catalog, { ...defaultPelicanFilters, providers: ['moonshot'], query: 'kimi' }).map(entry => entry.id), ['second']);
  assert.deepEqual(getPelicanRows(board, catalog, { ...defaultPelicanFilters, query: 'GPT Original' }).map(entry => entry.id), ['first']);
  assert.equal(getPelicanRows(board, catalog, { ...defaultPelicanFilters, providers: ['openai'], query: 'Kimi' }).length, 0);
  assert.deepEqual(board, original);
});

test('equal verified scores share competition ranks and remain stable when sorting or filtering', () => {
  const board = boardOf([sample('pending-first'), scored('first-a', 100), scored('third', 90), scored('first-b', 100), sample('pending-second'), scored('fourth', 80)]);
  const rows = getPelicanRows(board, catalog, defaultPelicanFilters);
  assert.deepEqual(rows.map(entry => entry.id), ['first-a', 'first-b', 'third', 'fourth', 'pending-first', 'pending-second']);
  assert.deepEqual(getPelicanRankGroups(rows).map(group => [group.rank, group.entries.map(entry => entry.id)]), [[1, ['first-a', 'first-b']], [3, ['third']], [4, ['fourth']]]);
  assert.deepEqual(getPelicanLeaders(rows).map(entry => entry.id), ['first-a', 'first-b', 'third']);
  const reversed = getPelicanRows(board, catalog, { ...defaultPelicanFilters, order: 'asc' });
  assert.deepEqual(reversed.map(entry => entry.id), ['fourth', 'third', 'first-a', 'first-b', 'pending-first', 'pending-second']);
  assert.deepEqual(getPelicanLeaders(reversed), getPelicanLeaders(rows));
  const leaders = renderPelicanLeaders(rows, catalog, '/', true);
  assert.match(leaders, /并列第一名/);
  assert.match(leaders, /第三名/);
  assert.doesNotMatch(leaders, /第二名|fourth|pending-first/);
});

test('provisional works lead the page, empty formal tiers are collapsed, and state cards invent no podium', () => {
  const entry = sample();
  const leaders = renderPelicanLeaders([entry], catalog, '/', true);
  assert.equal((leaders.match(/class="champion-card /g) ?? []).length, 3);
  assert.doesNotMatch(leaders, /第一名|第二名|第三名|鹈鹕档位|夯/);
  const html = renderPelicanTiers([entry], catalog, '/', 'desc');
  assert.ok(html.indexOf('id="pelican-pending-entries"') < html.indexOf('<details class="pelican-formal-placeholder">'));
  assert.match(html, /<ul class="pelican-entries" id="pelican-pending-entries"/);
  assert.doesNotMatch(html, /<details class="pelican-formal-placeholder" open|rank-number/);
  assert.match(html, /<div class="pelican-formal-tiers">/);
});

test('recordings never autoplay, have controls and posters without JavaScript, and expose source verification gaps', () => {
  const entry = sample();
  entry.test.notes = ['缺少档位截图'];
  entry.test.promptStatus = 'variant';
  entry.test.promptText = '做一个白色猫咪骑自行车的html网页，用svg绘制';
  const html = renderPelicanTiers([entry], catalog, '/yuanbao-model-rankings/', 'desc');
  assert.match(html, /<video controls loop muted playsinline preload="none"/);
  assert.match(html, /poster="\/yuanbao-model-rankings\/media\/pelican\/sample-cat.webp"/);
  assert.match(html, /src="\/yuanbao-model-rankings\/media\/pelican\/sample-cat.mp4"/);
  assert.match(html, /\/yuanbao-model-rankings\/logos\/openai.svg/);
  assert.doesNotMatch(html, /autoplay/);
  for (const text of ['缺少档位截图', '措辞有差异', '待核实', '待补充', '待复核', '加载失败不计作模型失分']) assert.ok(html.includes(text));
  assert.match(html, /<details class="pelican-assessment"><summary>评分明细与测试记录/);
  assert.match(html, /录屏 0 秒、1.5 秒/);
});

test('all user-visible entry metadata and assessment notes are escaped', () => {
  const entry = sample();
  const injected = '<script>alert(1)</script>';
  entry.name = injected; entry.test.modelLabel = injected;
  entry.test.notes = [injected]; entry.assessment.criteria[0].reason = injected;
  const html = renderPelicanTiers([entry], catalog, '/', 'desc');
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});
