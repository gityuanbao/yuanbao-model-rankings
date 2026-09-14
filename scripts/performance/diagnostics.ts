export class PerformanceReviewError extends Error {
  constructor(message: string, public readonly details: Record<string, unknown>) {
    super(message);
    this.name = 'PerformanceReviewError';
  }
}

interface Identity { id: string; sourceModel: string; providerId: string }
interface Snapshot { sourceId: string; publishedAt: string; models: Identity[] }

// Report every missing identity so a rejected update is actionable. This never
// merges old rows into a candidate or permits a model to disappear silently.
export function assertRetainedModels(previous: Snapshot, candidate: Snapshot) {
  const missing = previous.models.filter(model => !candidate.models.some(next => next.id === model.id));
  if (!missing.length) return;
  const details = {
    kind: 'missing_models', sourceId: previous.sourceId,
    previousPublishedAt: previous.publishedAt, candidatePublishedAt: candidate.publishedAt,
    previousCount: previous.models.length, candidateCount: candidate.models.length,
    missingModels: missing.map(({ id, sourceModel, providerId }) => ({
      id, sourceModel, providerId,
      sameSourceCandidates: candidate.models.filter(next => next.sourceModel === sourceModel).map(next => ({ id: next.id, providerId: next.providerId })),
    })),
  };
  const names = missing.slice(0, 8).map(model => model.sourceModel).join('、');
  throw new PerformanceReviewError(`已收录模型被删除，需人工核对：${missing.length} 条（${names}${missing.length > 8 ? ' 等' : ''}）；候选 ${candidate.models.length} / 原有 ${previous.models.length} 条`, details);
}
