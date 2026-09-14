import test from 'node:test';
import assert from 'node:assert/strict';
import sourceCells from './fixtures/performance/arena-logo-model-cells.json';
import selectionData from '../data/performance/models.json';
import vision from '../data/performance/arena-vision-2026-08-27.json';
import { selectionSchema } from '../src/lib/performance-schema';
import { categorySelection, parseMainstreamModelCell, parseCategoryHtml, normalizeCategory, acceptCategorySnapshot } from '../scripts/performance/categories';

const selection=selectionSchema.parse(selectionData);
const now='2026-09-14T00:00:00.000Z';

test('真实 Runner 模型单元格的 Logo 标题不会改变已收录模型身份',()=>{
  for(const sample of sourceCells.entries){
    const model=categorySelection(sample.modelCell,selection);
    assert.ok(model,`${sample.category}: ${sample.modelCell}`);
    assert.deepEqual([model.sourceModel,model.providerId,model.id],[sample.expectedSourceModel,sample.expectedProviderId,sample.expectedId]);
  }
});

test('DeepSeek/MiniMax 合法名称保留厂商首词；前缀冲突不猜厂商或移花接木',()=>{
  assert.equal(parseMainstreamModelCell('DeepSeek V4 Pro DeepSeek · MIT')?.sourceModel,'DeepSeek V4 Pro');
  assert.equal(parseMainstreamModelCell('Minimax M3 MiniMax · Proprietary')?.sourceModel,'Minimax M3');
  assert.equal(categorySelection('Anthropic claude-fable-5 OpenAI · Proprietary',selection),undefined);
  assert.equal(categorySelection('Tencent claude-fable-5 Tencent · Proprietary',selection),undefined);
  assert.equal(categorySelection('Anthropic unknown-model Anthropic · Proprietary',selection),undefined);
  assert.equal(categorySelection('Anthropic claude-fable-5 · Proprietary',selection),undefined);
});

test('HTML 读取忽略 SVG/脚本的不可见文字，保留真实名称、得分和快照身份',()=>{
  const source={...vision,sourceRowCount:1,rows:[vision.rows[0]]};
  const expected=normalizeCategory(source,selection,now);
  // Reconstruct the observed SVG-title condition. This HTML is a test fixture,
  // not a claim that the runner uploaded the site's original DOM.
  const cells=source.rows[0].map((cell,index)=>`<td>${index===2?`<svg><title>Anthropic</title><path/></svg><span>${cell}</span><script>bad-name</script><style>.hidden{}</style>`:cell}</td>`).join('');
  const html=`<h1>Vision Arena</h1><p>Aug 27, 2026</p><p>1 models</p><table><thead><tr>${source.headers.map(cell=>`<th>${cell}</th>`).join('')}</tr></thead><tbody><tr>${cells}</tr></tbody></table>`;
  const parsed=parseCategoryHtml(html,'vision');
  assert.deepEqual(parsed,source);
  const candidate=normalizeCategory(parsed,selection,now,'official-page');
  assert.deepEqual(candidate.models,expected.models);
  assert.equal(acceptCategorySnapshot(expected,candidate),false);
  const wrongIdentity=structuredClone(candidate);
  wrongIdentity.models[0].id='different-model';
  assert.throws(()=>acceptCategorySnapshot(expected,wrongIdentity),/删除/);
});
