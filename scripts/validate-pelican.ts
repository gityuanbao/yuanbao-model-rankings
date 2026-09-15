import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import data from '../src/data/pelican.json';
import submissions from '../data/pelican/submissions-2026-09-14.json';
import presentation from '../data/pelican/presentation-2026-09-14.json';
import reviews from '../data/pelican/reviews-2026-09-14.json';
import htmlIntake from '../data/pelican/html-intake-2026-09-14.json';
import htmlReviews from '../data/pelican/html-review-2026-09-14.json';
import { getPelicanCounts, isPelicanV3Entry, pelicanSchema } from '../src/lib/pelican';
import { getManualTotal, pelicanManualBoard } from '../src/lib/pelican-manual';

const board = pelicanSchema.parse(data);
const intake = new Map(submissions.entries.map(entry => [entry.id, entry]));
const displays = new Map(presentation.entries.map(entry => [entry.id, entry]));
for (const entry of board.entries) {
  const paths = isPelicanV3Entry(entry) ? [entry.media.src, entry.media.poster] : [entry.gif];
  if (isPelicanV3Entry(entry) && entry.artifact) paths.push(entry.artifact.src, entry.artifact.download);
  for (const path of paths) assert.ok((await stat(resolve('public', path))).size > 0, `${entry.id} 资源不能为空`);
  const source = intake.get(entry.id);
  if (!source) continue; // Later batches retain their own intake manifest.
  assert.equal(entry.name, source.name, `${entry.id} 不能静默替换提交型号`);
  assert.equal(entry.providerId, source.providerId);
  if (!isPelicanV3Entry(entry)) throw new Error('v3 回传作品不可按旧规则导入');
  const display = displays.get(entry.id);
  assert.ok(display, `${entry.id} 缺少统一展示记录`);
  assert.equal(display.sourceSha256, source.sourceSha256, '统一画幅不能替换源 GIF');
  assert.deepEqual(entry.media, display.media, `${entry.id} 媒体映射与统一展示记录不一致`);
  assert.equal(entry.media.width, 960); assert.equal(entry.media.height, 720);
  assert.equal(display.frames, source.frames); assert.equal(display.durationMs, source.durationMs);
  for (const [path, sha] of [[entry.media.src, display.videoSha256], [entry.media.poster, display.posterSha256]]) {
    const actual = createHash('sha256').update(await readFile(resolve('public', path))).digest('hex');
    assert.equal(actual, sha, `${entry.id} 资源与入库核验记录不一致`);
  }
  if (entry.artifact) {
    const html = await readFile(resolve('public', entry.artifact.src));
    assert.equal(createHash('sha256').update(html).digest('hex'), entry.artifact.sha256, 'HTML 必须保留提交原文');
    const original = htmlIntake.entries.find(item => item.id === entry.id);
    assert.ok(original, `${entry.id} 缺少 HTML 回传记录`);
    assert.equal(entry.artifact.sha256, original.sourceHtmlSha256, 'HTML 必须与对应回传文件一致');
    const zip = await readFile(resolve('public', entry.artifact.download));
    assert.equal(createHash('sha256').update(zip).digest('hex'), original.sourceZipSha256, '下载压缩包必须保留提交原件');
    const htmlReview = htmlReviews.entries.find(item => item.id === entry.id);
    assert.ok(htmlReview, `${entry.id} 缺少 HTML 运行记录`);
    assert.equal(htmlReview.sourceHtmlSha256, entry.artifact.sha256);
    assert.equal(htmlReview.assessmentStatus, entry.assessment.status, '评分状态须与当前核验记录一致');
  }
  const review = reviews.reviews.find(review => review.sourceGif === source.sourceGif);
  assert.ok(review, `${entry.id} 缺少原 GIF 初评记录`);
  assert.equal(review.modelNameFromSubmission, entry.name, '不能根据 GIF 文件名推断型号');
  for (const criterion of entry.assessment.criteria) {
    assert.ok(criterion.evidenceTimes.every(time => time < source.durationMs / 1000), `${entry.id}/${criterion.id} 证据超出录屏时长`);
  }
}
const counts = getPelicanCounts(board.entries);
for (const result of pelicanManualBoard.entries) {
  const entry = board.entries.find(entry => entry.id === result.id);
  assert.ok(entry, `${result.id} 人工评分必须对应已收录作品`);
  assert.equal(entry.name, result.name, '人工评分型号必须与回传表一致');
  assert.equal(getManualTotal(result.scores), result.submittedTotal, '人工总分必须与五项得分一致');
}
console.log(`大模型科目三校验通过：${counts.total} 份作品，${pelicanManualBoard.entries.length} 份人工评分；原作和历史记录有效，按 10 分制人工成绩排名。`);
