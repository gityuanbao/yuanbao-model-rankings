import test from 'node:test';
import assert from 'node:assert/strict';
import data from '../src/data/pelican.json';
import { catalog } from '../src/lib/catalog';
import { defaultPelicanFilters, pelicanSchema } from '../src/lib/pelican';
import { getPelicanShowcaseEntries, getPelicanShowcaseRows, renderPelicanShowcase } from '../src/lib/pelican-showcase';

test('showcase preserves submission order and does not expose historical assessments or GIF references', () => {
  const board = pelicanSchema.parse(data);
  const entries = getPelicanShowcaseEntries(board);
  assert.deepEqual(entries.map(entry => entry.id), board.entries.map(entry => entry.id));
  assert.doesNotMatch(JSON.stringify(entries), /"assessment"|"criteria"|"score"|\.mp4|\.webp|\.gif/);
  const filters = { ...defaultPelicanFilters, providers: ['openai'] };
  const expected = entries.filter(entry => entry.providerId === 'openai');
  assert.deepEqual(getPelicanShowcaseRows(entries, catalog, filters), expected);
  assert.deepEqual(getPelicanShowcaseRows(entries, catalog, { ...filters, order: 'asc' }), expected);
});

test('showcase renders isolated HTML thumbnails and download links without numeric or tier ranking', () => {
  const entries = getPelicanShowcaseEntries(pelicanSchema.parse(data));
  const html = renderPelicanShowcase(entries, catalog, '/rankings/');
  assert.equal((html.match(/data-pelican-thumbnail=/g) ?? []).length, 14);
  assert.equal((html.match(/sandbox="allow-scripts"/g) ?? []).length, 14);
  assert.doesNotMatch(html, /<video|\.gif|\.mp4|\.webp|allow-same-origin|pelican-score|第一名|从夯到拉/);
  assert.match(html, /data-source="\/rankings\/pelican-originals\/gpt-6-astra.html.txt"/);
  assert.match(html, /download="gpt-6-astra.html"/);
  const absent = renderPelicanShowcase([{ ...entries[0], artifact: null }], catalog, '/');
  assert.match(absent, /HTML 原作待补充/);
  assert.doesNotMatch(absent, /<iframe|data-pelican-original/);
});

test('showcase escapes material notes and model names in every HTML context', () => {
  const entry = getPelicanShowcaseEntries(pelicanSchema.parse(data))[0];
  const html = renderPelicanShowcase([{ ...entry, name: '<script>bad()</script>', note: '<img src=x onerror=bad()>' }], catalog, '/');
  assert.doesNotMatch(html, /<script>|<img src=x/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&lt;img/);
});
