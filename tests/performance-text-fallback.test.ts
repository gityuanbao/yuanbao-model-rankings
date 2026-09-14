import test from 'node:test';
import assert from 'node:assert/strict';
import official from '../data/performance/arena-text-2026-09-11.json';
import selectionData from '../data/performance/models.json';
import { selectionSchema } from '../src/lib/performance-schema';
import { normalizeArena, parseArenaImport } from '../scripts/performance/arena';
import { syncArenaText } from '../scripts/performance/sync-text';
import { PerformanceReviewError } from '../scripts/performance/diagnostics';

const selection = selectionSchema.parse(selectionData);
const now = '2026-09-14T00:00:00.000Z';
const imported = parseArenaImport(official);
const previous = normalizeArena(imported.rows,selection,now,imported.retrieval,imported.sourceUrl);
const apiRows = official.rows.map(({ score_precision, uncertainty, preliminary, ...row }) => ({ ...row, rating_lower:row.rating-1, rating_upper:row.rating+1 }));

function html(rows = official.rows, count = rows.length) {
  const headers = ['Rank','Rank Spread','Model','Score','Votes','Price $/M','Context'];
  const escaped = (value: unknown) => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
  return `<h1>Text Arena</h1><p>Sep 11, 2026</p><p>${count} models</p><table><thead><tr>${headers.map(cell=>`<th>${cell}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${[row.rank,`${row.rank} ${row.rank}`,`${row.model_name} ${row.organization} · fixture-license`,`${row.rating}±${row.uncertainty}${row.preliminary?' Preliminary':''}`,row.vote_count,'N/A','N/A'].map(cell=>`<td>${escaped(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}
const page = html();
function paginated(rows: typeof apiRows, input: RequestInfo | URL) {
  const offset = Number(new URL(String(input)).searchParams.get('offset'));
  return Response.json({num_rows_total:rows.length,rows:rows.slice(offset,offset+100).map(row=>({row,truncated_cells:[]}))});
}

test('API 超时后独立读取完整官网，保留原身份与整数分；相同榜单不更新', async () => {
  const calls: string[] = [];
  const result = await syncArenaText(previous,selection,now,async(input) => {
    const url = String(input);calls.push(url);
    if (url.startsWith('https://datasets-server.huggingface.co/')) throw new DOMException('fixture timeout','TimeoutError');
    assert.equal(url,'https://arena.ai/leaderboard/text');
    return new Response(page);
  });
  assert.equal(calls.length,2);
  assert.equal(result.source,'official-page');
  assert.equal(result.changed,false);
  assert.match(result.primaryFailure!.reason,/timeout/);
  assert.deepEqual(result.candidate.models,previous.models);
});

test('API 快照日期倒退也触发独立官网回退，而不是拼接旧 API 行', async () => {
  const oldRows = apiRows.map(row=>({...row,leaderboard_publish_date:'2026-09-10'}));
  const result = await syncArenaText(previous,selection,now,async(input) => String(input).startsWith('https://datasets-server.huggingface.co/') ? paginated(oldRows,input) : new Response(page));
  assert.equal(result.changed,false);
  assert.match(result.primaryFailure!.reason,/倒退/);
  assert.ok(result.candidate.models.every(model=>model.scorePrecision==='rounded'));
});

test('有效完整 API 直接通过，不为凑回退请求官网', async () => {
  const existing = normalizeArena(apiRows,selection,now);
  const result = await syncArenaText(existing,selection,now,async(input) => {
    assert.ok(String(input).startsWith('https://datasets-server.huggingface.co/'));
    return paginated(apiRows,input);
  });
  assert.equal(result.source,'official-api');
  assert.equal(result.changed,false);
  assert.equal(result.primaryFailure,undefined);
});

test('官网缺行、缺已有型号或超阈值仍拒绝，错误保留两处来源的完整原因', async () => {
  const missing = structuredClone(official.rows);
  missing[23] = {...missing[23],model_name:'fixture-outside-model',organization:'Outside'};
  const changed = structuredClone(official.rows);
  changed[0].rating += 101;
  for (const [body,reason] of [[html(official.rows.slice(0,-1),official.rows.length),/完整/],[html(missing),/删除.*gpt-6-astra-max/],[html(changed),/超过 100 分/]] as const) {
    const before = JSON.stringify(previous);
    await assert.rejects(syncArenaText(previous,selection,now,async(input) => {
      if (String(input).startsWith('https://datasets-server.huggingface.co/')) throw new Error('fixture API failure');
      return new Response(body);
    }), (error: unknown) => {
      assert.ok(error instanceof PerformanceReviewError);
      assert.equal(error.details.kind,'text_sources_failed');
      assert.match(error.message,/fixture API failure/);
      assert.match(error.message,reason);
      assert.ok(error.details.primaryFailure);
      assert.ok(error.details.fallbackFailure);
      return true;
    });
    assert.equal(JSON.stringify(previous),before);
  }
});
