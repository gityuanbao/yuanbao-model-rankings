import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import data from '../src/data/pelican.json';
import submissions from '../data/pelican/submissions-2026-09-14.json';
import reviews from '../data/pelican/reviews-2026-09-14.json';
import { getPelicanCounts, isPelicanV3Entry, pelicanSchema } from '../src/lib/pelican';

const board = pelicanSchema.parse(data);
const intake = new Map(submissions.entries.map(entry => [entry.id, entry]));
for (const entry of board.entries) {
  const paths = isPelicanV3Entry(entry) ? [entry.media.src, entry.media.poster] : [entry.gif];
  for (const path of paths) assert.ok((await stat(resolve('public', path))).size > 0, `${entry.id} 资源不能为空`);
  const source = intake.get(entry.id);
  if (!source) continue; // Later batches retain their own intake manifest.
  assert.equal(entry.name, source.name, `${entry.id} 不能静默替换提交型号`);
  assert.equal(entry.providerId, source.providerId);
  if (!isPelicanV3Entry(entry)) throw new Error('v3 回传作品不可按旧规则导入');
  assert.deepEqual(entry.media, source.media, `${entry.id} 媒体映射与回传记录不一致`);
  for (const [path, sha] of [[entry.media.src, source.videoSha256], [entry.media.poster, source.posterSha256]]) {
    const actual = createHash('sha256').update(await readFile(resolve('public', path))).digest('hex');
    assert.equal(actual, sha, `${entry.id} 资源与入库核验记录不一致`);
  }
  const review = reviews.reviews.find(review => review.sourceGif === source.sourceGif);
  assert.ok(review, `${entry.id} 缺少原 GIF 初评记录`);
  assert.equal(review.modelNameFromSubmission, entry.name, '不能根据 GIF 文件名推断型号');
  for (const criterion of entry.assessment.criteria) {
    assert.ok(criterion.evidenceTimes.every(time => time < source.durationMs / 1000), `${entry.id}/${criterion.id} 证据超出录屏时长`);
  }
}
const counts = getPelicanCounts(board.entries);
console.log(`鹈鹕数据校验通过：${counts.total} 份作品，${counts.provisional} 份待核验，${counts.verified} 份正式成绩；本地资源与入库映射有效。`);
