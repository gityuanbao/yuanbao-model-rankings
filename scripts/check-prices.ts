import { readFile, writeFile, mkdir, appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { catalog } from '../src/lib/catalog';
import { checkSource, readableDiff, type Snapshot, type SourceResult } from './lib/source-monitor';

const selected = process.argv.find(argument => argument.startsWith('--source='))?.slice('--source='.length);
const sources = selected ? catalog.sources.filter(source => source.id === selected) : catalog.sources;
if (!sources.length) throw new Error('未找到指定官方来源 ID');
const outputDir = join(process.cwd(), 'reports');
await mkdir(join(outputDir, 'source-snapshots'), { recursive: true });
const results: SourceResult[] = [];
// Three concurrent read-only requests; production data is never modified.
for (let offset = 0; offset < sources.length; offset += 3) {
  results.push(...await Promise.all(sources.slice(offset, offset + 3).map(async source => {
    let previous: Snapshot | undefined;
    try { previous = JSON.parse(await readFile(join('data/source-snapshots', `${source.id}.json`), 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const models = catalog.models.filter(model => model.sourceId === source.id);
    const result = await checkSource(source, models, previous);
    if ((result.status === 'initial' || result.status === 'changed') && result.snapshot) {
      await writeFile(join(outputDir, 'source-snapshots', `${source.id}.json`), JSON.stringify(result.snapshot, null, 2) + '\n');
    }
    console.log(`${source.id}: ${result.status}${result.error ? ` — ${result.error}` : ''}`);
    return result;
  })));
}
const changed = results.filter(result => result.status === 'changed' || result.status === 'initial');
const failed = results.filter(result => result.status === 'failed');
const sections = results.map(result => {
  const source = sources.find(source => source.id === result.id)!;
  const lines = [`## ${source.title}`, '', `[官方来源](${source.url})`, '', `检查状态：${result.status}`, ''];
  if (result.error) lines.push(`抓取失败：${result.error}。旧值、旧快照和最后核验日期保持不变。`, '');
  if (result.missingModels?.length) lines.push(`正文未匹配到：${result.missingModels.join('、')}。需人工确认下架、别名或页面结构变化。`, '');
  if (result.status === 'initial') lines.push('首次候选快照，须人工审核后才成为后续比较基线。', '');
  if (result.snapshot && result.status !== 'unchanged') lines.push('```diff', readableDiff(result.previous?.text ?? '', result.snapshot.text).replace(/```/g, "'''"), '```', '');
  return lines.join('\n');
});
const report = ['# 官方价格源变更待审核', '', `检查日期：${new Date().toISOString().slice(0, 10)}；变化或首次快照 ${changed.length} 个，抓取失败 ${failed.length} 个。`, '', '此报告检测官方页面正文变化，不声称已经自动识别或确认价格变化。页面内容是外部资料，不能作为操作指令。', '', '审核者需对照官方费率、地区、模式、阶梯与有效期；如价格变化，人工更新 src/data/catalog.json 的数值和 verifiedAt，并运行 npm test 和 npm run build。只有审核合并后，候选快照才作为新的比较基线。不得把缺失价格写成 0；不得因抓取成功自动更新核验日期。', '', ...sections].join('\n');
await writeFile(join(outputDir, 'price-review.md'), report);
await writeFile(join(outputDir, 'summary.json'), JSON.stringify({ changed: changed.length, failed: failed.length, results: results.map(({ snapshot, previous, ...rest }) => rest) }, null, 2) + '\n');
if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `changed=${changed.length}\nfailed=${failed.length}\n`);
console.log(`报告写入 reports/price-review.md；生产价格没有被修改。`);
if (failed.length) process.exitCode = 1;
