import test from 'node:test';
import assert from 'node:assert/strict';
import data from '../src/data/pelican.json';
import { catalog } from '../src/lib/catalog';
import { defaultPelicanFilters, pelicanSchema } from '../src/lib/pelican';
import { getPelicanShowcaseEntries, getPelicanShowcaseRows, renderPelicanShowcase } from '../src/lib/pelican-showcase';
import { getManualTotal, pelicanManualBoard, pelicanManualSchema } from '../src/lib/pelican-manual';

test('showcase preserves submission order and does not expose historical assessments or GIF references', () => {
  const board = pelicanSchema.parse(data);
  const entries = getPelicanShowcaseEntries(board);
  assert.deepEqual(entries.map(entry => entry.id), board.entries.map(entry => entry.id));
  assert.doesNotMatch(JSON.stringify(entries), /"assessment"|"criteria"|"score"|"test"|\.mp4|\.webp|\.gif/);
  const filters = { ...defaultPelicanFilters, providers: ['openai'] };
  const expected = entries.filter(entry => entry.providerId === 'openai');
  assert.deepEqual(getPelicanShowcaseRows(entries, catalog, filters), expected);
  assert.deepEqual(getPelicanShowcaseRows(entries, catalog, { ...filters, order: 'asc' }), expected);
});

test('showcase renders isolated HTML thumbnails, manual marks and one high-to-low rail', () => {
  const entries = getPelicanShowcaseEntries(pelicanSchema.parse(data));
  const html = renderPelicanShowcase(entries, catalog, '/rankings/');
  assert.equal((html.match(/data-pelican-thumbnail=/g) ?? []).length, 14);
  assert.equal((html.match(/sandbox="allow-scripts"/g) ?? []).length, 14);
  assert.doesNotMatch(html, /<video|\.gif|\.mp4|\.webp|allow-same-origin|第一名|测试记录|pelican-test-record/);
  assert.equal((html.match(/class="pelican-rank-rail"/g) ?? []).length, 1);
  assert.match(html, /<span>夯<\/span><i><\/i><span>拉<\/span>/);
  assert.equal((html.match(/data-score=/g) ?? []).length, 14);
  assert.match(html, /五项评分/);
  assert.match(html, /data-source="\/rankings\/pelican-originals\/gpt-6-astra.html.txt"/);
  assert.match(html, /download="gpt-6-astra.html"/);
  const absent = renderPelicanShowcase([{ ...entries[0], artifact: null }], catalog, '/');
  assert.match(absent, /HTML 原作待补充/);
  assert.doesNotMatch(absent, /<iframe|data-pelican-original/);
});

test('manual ranking follows all returned totals, keeps ties stable and cannot be reversed by old links', () => {
  const entries = getPelicanShowcaseEntries(pelicanSchema.parse(data));
  const rows = getPelicanShowcaseRows(entries, catalog, defaultPelicanFilters);
  assert.deepEqual(rows.map(entry => [entry.id, entry.manual?.total]), [
    ['gpt-6-astra', 10], ['gpt-5-6-sol', 10], ['deepseek-v4-1-flash', 8.5], ['deepseek-v4-pro-0813', 8.5],
    ['kimi-k3', 7.5], ['doubao-seed-2-1-pro', 6.5], ['qwen3-8-max-0902', 6], ['claude-fable-5-1', 5],
    ['claude-opus-5', 5], ['glm-5-3', 4], ['grok-4-6', 4], ['gemini-3-1-pro-preview', 3.5],
    ['gemini-3-8-flash', 3], ['minimax-m3', 2],
  ]);
  assert.deepEqual(getPelicanShowcaseRows(entries, catalog, { ...defaultPelicanFilters, order: 'asc' }), rows);
  assert.deepEqual(getPelicanShowcaseRows(entries, catalog, { ...defaultPelicanFilters, providers: ['google'] }).map(entry => entry.manual!.total), [3.5, 3]);
  assert.equal(entries[1].id, 'claude-fable-5-1', 'sorting must not mutate the submission order');
  assert.equal((renderPelicanShowcase(rows, catalog, '/').match(/class="pelican-tied"/g) ?? []).length, 8);
});

test('ungraded submissions stay outside the rail, and zero is a real manual score', () => {
  const entries = getPelicanShowcaseEntries(pelicanSchema.parse(data));
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
    const bad = structuredClone(pelicanManualBoard) as any;
    bad.entries[0].scores.cat = value;
    assert.equal(pelicanManualSchema.safeParse(bad).success, false);
  }
  const bad = structuredClone(pelicanManualBoard);
  bad.entries[0].submittedTotal = 9;
  assert.equal(pelicanManualSchema.safeParse(bad).success, false);
  bad.entries[0].submittedTotal = 10;
  bad.entries.push(bad.entries[0]);
  assert.equal(pelicanManualSchema.safeParse(bad).success, false);
});

test('showcase escapes material notes and model names in every HTML context', () => {
  const entry = getPelicanShowcaseEntries(pelicanSchema.parse(data))[0];
  const html = renderPelicanShowcase([{ ...entry, name: '<script>bad()</script>', note: '<img src=x onerror=bad()>' }], catalog, '/');
  assert.doesNotMatch(html, /<script>|<img src=x/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&lt;img/);
});
