import type { PerformanceSelection, PerformanceSnapshot } from '../../src/lib/performance-schema';
import { acceptSnapshot, fetchArena, normalizeArena } from './arena';
import { fetchArenaPage, normalizeArenaPage } from './arena-page';
import { PerformanceReviewError } from './diagnostics';

export interface SourceFailure { reason: string; details?: Record<string, unknown> }
const describe = (error: unknown): SourceFailure => ({
  reason:error instanceof Error ? `${error.message}${error.cause instanceof Error ? ` (${error.cause.message})` : ''}` : String(error),
  ...(error instanceof PerformanceReviewError ? { details:error.details } : {}),
});

export interface TextSyncResult {
  candidate: PerformanceSnapshot;
  changed: boolean;
  source: 'official-api' | 'official-page';
  primaryFailure?: SourceFailure;
  fallback?: string;
}

// Each source must independently pass the same identity, date and change gates.
// No writes, row merging, fabricated organizations, or approval bypass here.
export async function syncArenaText(previous: PerformanceSnapshot | null, selection: PerformanceSelection, now: string, fetcher: typeof fetch = fetch): Promise<TextSyncResult> {
  let primaryFailure: SourceFailure;
  try {
    const candidate = normalizeArena(await fetchArena(fetcher), selection, now);
    return { candidate, changed:acceptSnapshot(previous,candidate), source:'official-api' };
  } catch (error) {
    primaryFailure = describe(error);
  }
  try {
    const candidate = normalizeArenaPage(await fetchArenaPage(fetcher), selection, now);
    return { candidate, changed:acceptSnapshot(previous,candidate), source:'official-page', primaryFailure,
      fallback:'官方数据集不可用或未通过校验，改用独立完整的 Arena 官方文本榜；没有混合两个来源。' };
  } catch (error) {
    const fallbackFailure = describe(error);
    throw new PerformanceReviewError(`文本两处官方来源均未通过：数据集：${primaryFailure.reason}；官网：${fallbackFailure.reason}`, {
      kind:'text_sources_failed', primaryFailure, fallbackFailure,
    });
  }
}
