import test from 'node:test';
import assert from 'node:assert/strict';
import { fixtureCatalog as catalog } from './fixtures/catalog';
import { checkSource, normalizePage, readableDiff, type Snapshot } from '../scripts/lib/source-monitor';

const source = catalog.sources.find(source => source.providerId === 'deepseek')!;
const models = catalog.models.filter(model => model.providerId === 'deepseek');
const page = `<main><h1>Models &amp; Pricing</h1><p>deepseek-flash deepseek-v4-pro Input tokens pricing 0.3 / 1M; Output tokens pricing 1.2 / 1M.</p><p>${'Pricing details for official API. '.repeat(6)}</p></main>`;
const mock = (body: string, status = 200, headers: Record<string, string> = {}) => (async () => new Response(body, { status, headers })) as typeof fetch;
test('空页、HTTP 失败、动态壳和反爬页面保留旧价格与旧快照，不生成 0', async () => {
  const before = JSON.stringify(catalog);
  const previous: Snapshot = { url: source.url, sha256: 'old', text: 'old verified text' };
  for (const [body, status] of [['', 200], ['Unavailable', 503], ['Just a moment. '.repeat(20), 200], ['Navigation page without model pricing. '.repeat(20), 200]] as const) {
    const result = await checkSource(source, models, previous, mock(body, status));
    assert.equal(result.status, 'failed'); assert.equal(result.snapshot, undefined); assert.deepEqual(result.previous, previous);
  }
  assert.equal(JSON.stringify(catalog), before);
});
test('首次快照需审核，未变页保持基线，价格变动可读 diff', async () => {
  const initial = await checkSource(source, models, undefined, mock(page));
  assert.equal(initial.status, 'initial');
  assert.equal((await checkSource(source, models, initial.snapshot, mock(page))).status, 'unchanged');
  const changed = await checkSource(source, models, initial.snapshot, mock(page.replace('0.3', '0.4')));
  assert.equal(changed.status, 'changed');
  assert.match(readableDiff(initial.snapshot!.text, changed.snapshot!.text), /- .*0\.3/);
  assert.match(readableDiff(initial.snapshot!.text, changed.snapshot!.text), /\+ .*0\.4/);
});
test('重定向不能离开对应官方厂商域名', async () => {
  let count = 0;
  const fetcher = (async () => { count++; return new Response('', { status: 302, headers: { location: 'https://attacker.example/pricing' } }); }) as typeof fetch;
  const result = await checkSource(source, models, undefined, fetcher);
  assert.equal(result.status, 'failed'); assert.equal(count, 1);
});
test('HTML 脚本内容不参与价格正文比较', () => {
  assert.equal(normalizePage('<main><p>输入 &yen;1</p><script>random = 99</script></main>'), '输入 ¥1');
});
