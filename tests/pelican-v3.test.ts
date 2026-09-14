import test from 'node:test';
import assert from 'node:assert/strict';
import { catalog } from '../src/lib/catalog';
import { defaultPelicanFilters, getPelicanCounts, getPelicanLeaders, getPelicanRankGroups, getPelicanRows, getPelicanScore, getPelicanTier, getPelicanTiers, isPelicanRankable, isPelicanVerified, pelicanCriteria, pelicanPrompt, pelicanSchema, pelicanV3EntrySchema, type PelicanV3Entry } from '../src/lib/pelican';
import { renderPelicanLeaders, renderPelicanTiers } from '../src/lib/pelican-render';

function sample(id = 'sample-cat', status: 'provisional' | 'scored' | 'verified' = 'provisional'): PelicanV3Entry {
  return {
    id, name: `白猫 ${id}`, providerId: 'openai', ruleVersion: '3.0',
    media: { type: 'video', src: `media/pelican/${id}.mp4`, poster: `media/pelican/${id}.webp`, width: 1000, height: 750 },
    ...(status !== 'provisional' ? { artifact: { src: `pelican-originals/${id}.html.txt`, download: `pelican-originals/${id}.zip`, sha256: 'a'.repeat(64), htmlVerifiedAt: '2026-09-14', svgVerified: true, runStatus: 'passed' as const } } : {}),
    test: { modelLabel: `测试型号 ${id}`, platform: status === 'verified' ? '测试平台' : null, effort: status === 'verified' ? '最高' : null, date: status === 'verified' ? '2026-09-14' : null, tools: status === 'verified' ? 'none' : 'unknown', codeModified: status === 'verified' ? false : null, identityStatus: status === 'verified' ? 'verified' : 'submitted', firstAttempt: status === 'verified' ? true : null, promptStatus: status === 'verified' ? 'exact' : 'unknown', promptText: status === 'verified' ? pelicanPrompt : null, notes: [] },
    assessment: { status, reviewedAt: '2026-09-14', reviewer: 'AI', ownerConfirmed: status === 'verified', criteria: pelicanCriteria.map(criterion => ({ id: criterion.id, score: criterion.kind === 'technical' && status === 'provisional' ? null : criterion.maximum, reason: criterion.kind === 'technical' && status === 'provisional' ? '缺少原始 HTML，待核验' : '可见画面满足对应要求', evidenceTimes: criterion.kind === 'visual' ? [0, 1.5] : [] })) },
  };
}
const boardOf = (entries: PelicanV3Entry[]) => pelicanSchema.parse({ schemaVersion: 2, ruleVersion: '3.0', entries });

function scored(id: string, total: number, status: 'scored' | 'verified' = 'verified') {
  const entry = sample(id, status);
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
  assert.deepEqual(getPelicanCounts([entry]), { total: 1, provisional: 1, verified: 0, ranked: 0, scored: 0 });
  assert.deepEqual(getPelicanLeaders([entry]), []);
  assert.ok(getPelicanTiers(boardOf([entry])).every(tier => tier.entries.length === 0));
  const html = renderPelicanTiers([entry], catalog, '/', 'desc');
  assert.match(html, /画面观察分 90 \/ 90/);
  assert.match(html, /原作与评分证据待确认 · 暂未定档/);
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

test('complete AI artwork scores enter tiers without inventing owner confirmation or missing test metadata', () => {
  const entry = sample('ai-scored', 'scored');
  entry.test.promptStatus = 'variant';
  entry.test.promptText = '做一个白色猫咪骑自行车的html网页，用svg绘制';
  const parsed = pelicanV3EntrySchema.parse(entry);
  assert.equal(isPelicanRankable(parsed), true);
  assert.equal(isPelicanVerified(parsed), false);
  assert.equal(parsed.assessment.ownerConfirmed, false);
  assert.equal(parsed.test.date, null);
  assert.equal(parsed.test.effort, null);
  assert.equal(parsed.test.tools, 'unknown');
  assert.deepEqual(getPelicanScore(parsed), { visual: 90, visualCompleted: 9, total: 100 });
  assert.equal(getPelicanTier(parsed), 'hang');
  assert.deepEqual(getPelicanCounts([parsed, sample('pending'), sample('owner-reviewed', 'verified')]), {
    total: 3, provisional: 1, verified: 1, ranked: 2, scored: 1,
  });
});

test('complete artwork scores require matched original files, strict provenance and actual technical evidence', () => {
  const mutations: Array<(entry: PelicanV3Entry) => void> = [
    entry => { delete entry.artifact; },
    entry => { entry.assessment.criteria[0].score = null; },
    entry => { entry.assessment.criteria[9].score = null; },
    entry => { entry.assessment.criteria[10].score = null; },
    entry => { entry.artifact!.src = 'pelican-originals/other.html.txt'; },
    entry => { entry.artifact!.src = 'pelican-originals/ai-scored.html'; },
    entry => { entry.artifact!.src = 'pelican-originals/../ai-scored.html.txt'; },
    entry => { entry.artifact!.download = 'https://example.com/ai-scored.zip'; },
    entry => { entry.artifact!.download = 'pelican-originals/other.zip'; },
    entry => { entry.artifact!.sha256 = 'a'.repeat(63); },
    entry => { entry.artifact!.sha256 = 'g'.repeat(64); },
    entry => { entry.artifact!.sha256 = 'A'.repeat(64); },
    entry => { entry.artifact!.htmlVerifiedAt = '2026-02-30'; },
    entry => { entry.artifact!.htmlVerifiedAt = null; },
    entry => { entry.artifact!.runStatus = 'pending'; },
    entry => { entry.artifact!.runStatus = 'failed'; },
    entry => { entry.artifact!.svgVerified = false; },
  ];
  for (const mutate of mutations) {
    const entry = sample('ai-scored', 'scored'); mutate(entry);
    assert.equal(pelicanV3EntrySchema.safeParse(entry).success, false);
  }
  const failure = sample('documented-failure', 'scored');
  failure.artifact!.runStatus = 'failed';
  failure.artifact!.svgVerified = false;
  failure.assessment.criteria[9].score = 0;
  failure.assessment.criteria[10].score = 0;
  failure.assessment.criteria[9].reason = '原始 HTML 经运行检查确认没有显示作品';
  failure.assessment.criteria[10].reason = '完整代码检查确认未使用 SVG 绘制主体';
  assert.equal(getPelicanScore(pelicanV3EntrySchema.parse(failure)).total, 90);
});

test('an attached original can remain available while runtime evidence is pending without receiving a tier', () => {
  const pending = sample('attached-pending');
  pending.artifact = {
    src: 'pelican-originals/attached-pending.html.txt', download: 'pelican-originals/attached-pending.zip',
    sha256: 'f'.repeat(64), htmlVerifiedAt: null, svgVerified: false, runStatus: 'pending',
  };
  const parsed = pelicanV3EntrySchema.parse(pending);
  assert.ok(parsed.artifact);
  assert.equal(isPelicanRankable(parsed), false);
  assert.equal(getPelicanScore(parsed).total, null);
  assert.equal(getPelicanTier(parsed), null);
});

test('AI-scored and owner-reviewed artwork share stable score sorting, tiers and competition ranks', () => {
  const board = boardOf([
    sample('pending'), scored('ai-first', 100, 'scored'), scored('ai-fourth', 75, 'scored'),
    scored('verified-first', 100), scored('ai-third', 90, 'scored'),
  ]);
  const rows = getPelicanRows(board, catalog, defaultPelicanFilters);
  assert.deepEqual(rows.map(entry => entry.id), ['ai-first', 'verified-first', 'ai-third', 'ai-fourth', 'pending']);
  assert.deepEqual(getPelicanRankGroups(rows).map(group => [group.rank, group.entries.map(entry => entry.id)]), [
    [1, ['ai-first', 'verified-first']], [3, ['ai-third']], [4, ['ai-fourth']],
  ]);
  assert.deepEqual(getPelicanLeaders(rows).map(entry => entry.id), ['ai-first', 'verified-first', 'ai-third']);
  const ascending = getPelicanRows(board, catalog, { ...defaultPelicanFilters, order: 'asc' });
  assert.deepEqual(ascending.map(entry => entry.id), ['ai-fourth', 'ai-third', 'ai-first', 'verified-first', 'pending']);
  assert.deepEqual(getPelicanLeaders(ascending), getPelicanLeaders(rows));
  assert.deepEqual(getPelicanTiers(board)[0].entries.map(entry => entry.id), ['ai-first', 'verified-first', 'ai-third']);
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

test('five visible tiers preserve the scale even before scores, pending works are separate and state cards invent no podium', () => {
  const entry = sample();
  const leaders = renderPelicanLeaders([entry], catalog, '/', true);
  assert.equal((leaders.match(/class="champion-card /g) ?? []).length, 3);
  assert.doesNotMatch(leaders, /第一名|第二名|第三名|鹈鹕档位|夯/);
  const html = renderPelicanTiers([entry], catalog, '/', 'desc');
  assert.ok(html.indexOf('class="pelican-formal-tiers"') < html.indexOf('id="pelican-pending-entries"'));
  assert.match(html, /<ul class="pelican-entries" id="pelican-pending-entries"/);
  assert.doesNotMatch(html, /pelican-formal-placeholder|rank-number/);
  assert.match(html, /<div class="pelican-formal-tiers">/);
  assert.deepEqual([...html.matchAll(/id="tier-([a-z]+)"/g)].map(match => match[1]), ['hang', 'top', 'good', 'npc', 'la']);
  assert.match(html, /材料待确认/);
});

test('the three leader cards show three artworks with actual tied ranks, not every tied artwork in one card', () => {
  const rows = getPelicanRows(boardOf([
    scored('tied-first-a', 100, 'scored'), scored('tied-first-b', 100, 'scored'),
    scored('tied-first-c', 100, 'scored'), scored('tied-first-d', 100, 'scored'),
    scored('fifth', 90, 'scored'), sample('pending'),
  ]), catalog, defaultPelicanFilters);
  const html = renderPelicanLeaders(rows, catalog, '/', true);
  assert.equal((html.match(/class="champion-card /g) ?? []).length, 3);
  assert.equal((html.match(/class="champion-model"/g) ?? []).length, 3);
  assert.equal((html.match(/并列第一名/g) ?? []).length, 3);
  assert.equal((html.match(/100 \/ 100 分 · AI 评分/g) ?? []).length, 3);
  assert.doesNotMatch(html, /tied-first-d|fifth|pending|第二名|第三名|已复核/);
  const tiedSecond = renderPelicanLeaders([scored('first', 100), scored('second-a', 90, 'scored'), scored('second-b', 90, 'scored')], catalog, '/', true);
  assert.equal((tiedSecond.match(/并列第二名/g) ?? []).length, 2);
  assert.doesNotMatch(tiedSecond, /第三名/);
});

test('ranked artwork exposes original HTML using the deployment base and separates AI scoring from owner review', () => {
  const entry = sample('ai-original', 'scored');
  const html = renderPelicanTiers([entry], catalog, '/yuanbao-model-rankings/', 'desc');
  assert.match(html, /AI 作品评分 100 \/ 100/);
  assert.match(html, /HTML 已核验/);
  assert.match(html, /<button type="button" class="pelican-original-button" data-pelican-original="ai-original"/);
  assert.match(html, /href="\/yuanbao-model-rankings\/pelican-originals\/ai-original\.html\.txt" download="ai-original\.html"/);
  assert.match(html, /源宝复核<\/dt><dd>待复核/);
  assert.doesNotMatch(html, /源宝已复核|原作与评分证据待确认|<iframe|srcdoc=|href="[^"<>]*\.html"/);

  const injected = '\"><img src=x onerror=alert(1)>';
  entry.name = injected;
  entry.id = injected;
  entry.artifact!.src = `pelican-originals/${injected}.html.txt`;
  const escaped = renderPelicanTiers([entry], catalog, '/base-\"quoted\"/', 'desc');
  assert.doesNotMatch(escaped, /<img src=x|data-pelican-original=""><img|href="\/base-"quoted"/);
  assert.match(escaped, /data-pelican-original="&quot;&gt;&lt;img/);
  assert.match(escaped, /\/base-&quot;quoted&quot;\/pelican-originals\/&quot;&gt;&lt;img/);
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
