import type { Model } from '../../src/lib/schema';
import { normalizedPriceSchema, type ProviderAdapter, type ProviderRun } from './types';

export async function runProvider(adapter: ProviderAdapter, models: Model[], checkedAt = new Date().toISOString()): Promise<ProviderRun> {
  const run = { providerId: adapter.providerId, mode: adapter.mode, checkedAt };
  // A declared manual adapter has no verified parser. It is maintenance work,
  // not a failed fetch, and must not refresh any model's verification timestamp.
  if (adapter.mode === 'manual') return { ...run, manualReason: adapter.reason ?? '尚需人工核对官方价格' };
  try {
    const raw = await adapter.fetch();
    const parsed = adapter.parse(raw, models);
    parsed.items = parsed.items.filter(item => {
      const valid = normalizedPriceSchema.safeParse(item);
      if (valid.success) return true;
      parsed.issues.push({ modelId: item.modelId, reason: valid.error.issues.map(issue => issue.message).join('；') });
      return false;
    });
    const valid = adapter.validate(parsed.items);
    if (!valid.valid) throw new Error(valid.errors.join('；'));
    if (!parsed.items.length && !parsed.discoveries.length) throw new Error(parsed.issues.map(issue => issue.reason).join('；') || '未解析到标准输入/输出价格');
    return { ...run, parsed };
  } catch (error) {
    return { ...run, error: error instanceof Error ? error.message : String(error) };
  }
}
