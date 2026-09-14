import type { Model } from '../../src/lib/schema';
import { normalizedPriceSchema, type ProviderAdapter, type ProviderRun } from './types';

export async function runProvider(adapter: ProviderAdapter, models: Model[], checkedAt = new Date().toISOString()): Promise<ProviderRun> {
  const run = { providerId: adapter.providerId, mode: adapter.mode, checkedAt };
  // A declared manual adapter has no verified parser. It is maintenance work,
  // not a failed fetch, and must not refresh any model's verification timestamp.
  if (adapter.mode === 'manual') return { ...run, manualReason: adapter.reason ?? '尚需人工核对官方价格' };
  try {
    const providerModels = models.filter(model => model.providerId === adapter.providerId);
    const raw = await adapter.fetch();
    const parsed = adapter.parse(raw, providerModels);
    parsed.issues = parsed.issues.map(issue => ({ ...issue, kind: issue.kind === 'manual_required' ? 'manual_required' : 'parse_error' }));
    parsed.items = parsed.items.filter(item => {
      const valid = normalizedPriceSchema.safeParse(item);
      if (valid.success) return true;
      parsed.issues.push({ modelId: item.modelId, reason: valid.error.issues.map(issue => issue.message).join('；'), kind: 'parse_error' });
      return false;
    });
    const valid = adapter.validate(parsed.items);
    if (!valid.valid) throw new Error(valid.errors.join('；'));
    // A discovery must not hide lost prices for models already in the catalog.
    const accountedFor = new Set([...parsed.items.map(item => item.modelId), ...parsed.issues.map(issue => issue.modelId)]);
    for (const model of providerModels.filter(model => model.status !== 'retired')) {
      if (!accountedFor.has(model.id)) parsed.issues.push({ modelId: model.id, reason: '已收录模型的标准价格缺失，保留旧价', kind: 'parse_error' });
    }
    if (!parsed.items.length && !parsed.discoveries.length && !parsed.issues.length) throw new Error('未解析到标准输入/输出价格');
    // Keep valid rows usable even when another row failed. The report counts
    // parse_error issues as failures without discarding the whole provider.
    return { ...run, parsed };
  } catch (error) {
    return { ...run, error: error instanceof Error ? error.message : String(error) };
  }
}
