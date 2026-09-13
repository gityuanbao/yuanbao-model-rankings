import type { Model } from '../../src/lib/schema';
import { historySchema, type PriceHistory } from '../../src/lib/pricing-metadata';
import { hash, officialPrice, stable } from './diff';
import type { NormalizedPrice } from './types';
export function appendHistory(history: PriceHistory, old: Model, next: Model, candidate: NormalizedPrice, detectedAt: string, verification: 'auto_verified' | 'manual_verified', types: string[], previousUrl: string): PriceHistory {
  const result = structuredClone(history);
  if (stable(officialPrice(old)) === stable(officialPrice(next))) return result;
  let entry = result.models.find(m => m.modelId === old.id);
  if (!entry) {
    entry = { modelId: old.id, providerId: old.providerId, events: [{ id: hash([old.id,officialPrice(old)]).slice(0,24), detectedAt: `${old.verifiedAt}T00:00:00Z`, effectiveAt: null, ...{currency:old.currency,rates:old.rates}, sourceUrl: previousUrl, reason:'initial_snapshot', verification:'manual_verified', changeTypes:[] }] };
    result.models.push(entry);
  }
  const id = hash([old.id, officialPrice(old), officialPrice(next), detectedAt]).slice(0,24);
  if (!entry.events.some(e => e.id === id) && stable(officialPrice(entry.events.at(-1)!)) !== stable(officialPrice(next))) {
    entry.events.push({ id, detectedAt, effectiveAt:candidate.effectiveAt, currency:next.currency, rates:next.rates, sourceUrl:candidate.sourceUrl, reason:'price_change', verification, changeTypes:types });
  }
  return historySchema.parse(result);
}
