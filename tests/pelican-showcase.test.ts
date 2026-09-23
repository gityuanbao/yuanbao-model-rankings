import test from 'node:test';
import assert from 'node:assert/strict';
import data from '../src/data/pelican.json';
import { pelicanHtmlBoard, pelicanHtmlSchema } from '../src/lib/pelican-html';
import { catalog } from '../src/lib/catalog';
import { defaultPelicanFilters, pelicanSchema } from '../src/lib/pelican';
import { getPelicanShowcaseEntries, getPelicanShowcaseRows, renderPelicanShowcase } from '../src/lib/pelican-showcase';
import { getManualTotal, pelicanManualBoard, pelicanManualSchema, pelicanManualBatches, combinePelicanManualBatches } from '../src/lib/pelican-manual';

test('showcase preserves submission order and does not expose historical assessments or GIF references', () => {
  const board = pelicanSchema.parse(data);
  const entries = getPelicanShowcaseEntries(board, pelicanManualBoard, pelicanHtmlBoard.entries);
  assert.deepEqual(entries.map(entry => entry.id), [...board.entries, ...pelicanHtmlBoard.entries].map(entry => entry.id));
  assert.doesNotMatch(JSON.stringify(entries), /"assessment"|"criteria"|"score"|"test"|\.mp4|\.webp|\.gif/);
  const filters = { ...defaultPelicanFilters, providers: ['openai'] };
  const expected = entries.filter(entry => entry.providerId === 'openai');
  assert.deepEqual(getPelicanShowcaseRows(entries, catalog, filters), expected);
  assert.deepEqual(getPelicanShowcaseRows(entries, catalog, { ...filters, order: 'asc' }), expected);
});

test('showcase renders isolated HTML thumbnails, manual marks and one high-to-low rail', () => {
  const entries = getPelicanShowcaseEntries(pelicanSchema.parse(data), pelicanManualBoard, pelicanHtmlBoard.entries);
  const html = renderPelicanShowcase(entries, catalog, '/rankings/');
  assert.equal((html.match(/data-pelican-thumbnail=/g) ?? []).length, 17);
  assert.equal((html.match(/sandbox="allow-scripts"/g) ?? []).length, 17);
  assert.doesNotMatch(html, /<video|\.gif|\.mp4|\.webp|allow-same-origin|第一名|测试记录|pelican-test-record/);
  assert.equal((html.match(/class="pelican-rank-rail"/g) ?? []).length, 1);
  assert.match(html, /<span>夯<\/span><i><\/i><span>拉<\/span>/);
  assert.equal((html.match(/data-score=/g) ?? []).length, 17);
  assert.match(html, /五项评分/);
  assert.match(html, /data-source="\/rankings\/pelican-originals\/gpt-6-astra.html.txt"/);
  assert.match(html, /download="gpt-6-astra.html"/);
  const absent = renderPelicanShowcase([{ ...entries[0], artifact: null }], catalog, '/');
  assert.match(absent, /HTML 原作待补充/);
  assert.doesNotMatch(absent, /<iframe|data-pelican-original/);
});

test('manual ranking follows all returned totals, keeps ties stable and cannot be reversed by old links', () => {
  const entries = getPelicanShowcaseEntries(pelicanSchema.parse(data), pelicanManualBoard, pelicanHtmlBoard.entries);
  const rows = getPelicanShowcaseRows(entries, catalog, defaultPelicanFilters);
  assert.deepEqual(rows.map(entry => [entry.id, entry.manual?.total]), [
    ['gpt-6-astra', 10], ['gpt-5-6-sol', 10], ['deepseek-v4-1-flash', 8.5], ['deepseek-v4-pro-0813', 8.5],
    ['claude-opus-5-5', 8], ['kimi-k3', 7.5], ['gpt-6-sol', 7], ['doubao-seed-2-1-pro', 6.5], ['qwen3-8-max-0902', 6], ['claude-fable-5-1', 5],
    ['claude-opus-5', 5], ['glm-5-3', 4], ['grok-4-6', 4], ['gpt-6-luna', 4], ['gemini-3-1-pro-preview', 3.5],
    ['gemini-3-8-flash', 3], ['minimax-m3', 2],
  ]);
  assert.deepEqual(getPelicanShowcaseRows(entries, catalog, { ...defaultPelicanFilters, order: 'asc' }), rows);
  assert.deepEqual(getPelicanShowcaseRows(entries, catalog, { ...defaultPelicanFilters, providers: ['google'] }).map(entry => entry.manual!.total), [3.5, 3]);
  assert.equal(entries[1].id, 'claude-fable-5-1', 'sorting must not mutate the submission order');
  assert.equal((renderPelicanShowcase(rows, catalog, '/').match(/class="pelican-tied"/g) ?? []).length, 9);
});

test('ungraded submissions stay outside the rail, and zero is a real manual score', () => {
  const entries = getPelicanShowcaseEntries(pelicanSchema.parse(data), pelicanManualBoard, pelicanHtmlBoard.entries);
  entries[0].manual = null;
  entries[1].manual = { scores: { cat: 0, bicycle: 0, scenery: 0, motion: 0, design: 0 }, total: 0 };
  const rows = getPelicanShowcaseRows(entries, catalog, defaultPelicanFilters);
  assert.equal(rows.at(-2)!.id, 'claude-fable-5-1');
  assert.equal(rows.at(-1)!.id, 'gpt-6-astra');
  const html = renderPelicanShowcase(rows, catalog, '/');
  assert.match(html, /data-score="0"/);
  assert.ok(html.indexOf('class="pelican-unscored"') < html.indexOf('data-model-id="gpt-6-astra"'));
  assert.doesNotMatch(renderPelicanShowcase([rows.at(-1)!], catalog, '/'), /pelican-rank-rail/);
  assert.doesNotMatch(renderPelicanShowcase([], catalog, '/'), /pelican-rank-rail/);
});

test('manual schema rejects missing, duplicate, out-of-range, wrong-step and mismatched totals', () => {
  assert.equal(getManualTotal(pelicanManualBoard.entries[0].scores), 10);
  for (const value of [null, -0.5, 2.5, 0.25]) {
    const bad = structuredClone(pelicanManualBatches[0]) as any;
    bad.entries[0].scores.cat = value;
    assert.equal(pelicanManualSchema.safeParse(bad).success, false);
  }
  const bad = structuredClone(pelicanManualBatches[0]);
  bad.entries[0].submittedTotal = 9;
  assert.equal(pelicanManualSchema.safeParse(bad).success, false);
  bad.entries[0].submittedTotal = 10;
  bad.entries.push(bad.entries[0]);
  assert.equal(pelicanManualSchema.safeParse(bad).success, false);
});

test('showcase escapes material notes and model names in every HTML context', () => {
  const entry = getPelicanShowcaseEntries(pelicanSchema.parse(data), pelicanManualBoard, pelicanHtmlBoard.entries)[0];
  const html = renderPelicanShowcase([{ ...entry, name: '<script>bad()</script>', note: '<img src=x onerror=bad()>' }], catalog, '/');
  assert.doesNotMatch(html, /<script>|<img src=x/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&lt;img/);
});


test('new manual batches preserve chat provenance and reject duplicate IDs across intake batches', () => {
  assert.equal(pelicanManualBatches[0].entries.length, 14);
  assert.ok('kind' in pelicanManualBatches[1].source && pelicanManualBatches[1].source.kind === 'chat-table');
  assert.deepEqual(pelicanManualBatches[1].entries.map(entry => [entry.name, Object.values(entry.scores), getManualTotal(entry.scores)]), [
    ['Claude Opus 5.5', [1, 2, 1.5, 2, 1.5], 8],
    ['GPT-6 Sol', [1, 1.5, 1.5, 1.5, 1.5], 7],
    ['GPT-6 Luna', [0.5, 1, 1, 0.5, 1], 4],
  ]);
  assert.throws(() => combinePelicanManualBatches([pelicanManualBatches[0], pelicanManualBatches[0]]), /重复/);
  const duplicate = { ...pelicanHtmlBoard.entries[0], id: data.entries[0].id };
  assert.throws(() => getPelicanShowcaseEntries(pelicanSchema.parse(data), pelicanManualBoard, [duplicate]), /重复/);
  const invalidPath = structuredClone(pelicanHtmlBoard);
  invalidPath.entries[0].artifact.src = '../outside.html';
  assert.equal(pelicanHtmlSchema.safeParse(invalidPath).success, false);
});
