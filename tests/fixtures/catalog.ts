import data from './catalog-v2.json';
import { catalogSchema } from '../../src/lib/schema';
// Stable regression data. Live official prices must be allowed to change without breaking arithmetic tests.
export const fixtureCatalog = catalogSchema.parse(data);
import { historySchema, verificationFileSchema } from '../../src/lib/pricing-metadata';
export const fixtureHistory = historySchema.parse({schemaVersion:1,models:fixtureCatalog.models.map(m=>({modelId:m.id,providerId:m.providerId,events:[{id:`baseline-${m.id}`,detectedAt:'2026-09-12T00:00:00.000Z',effectiveAt:null,currency:m.currency,rates:m.rates,sourceUrl:fixtureCatalog.sources.find(s=>s.id===m.sourceId)!.url,reason:'initial_snapshot',verification:'manual_verified',changeTypes:[]}]}))});
const initial={status:'stale',lastCheckedAt:null,lastSuccessAt:null,verification:'manual_verified',reason:'fixture'};
export const fixtureVerification=verificationFileSchema.parse({schemaVersion:1,checkedAt:null,providers:Object.fromEntries(fixtureCatalog.providers.map(p=>[p.id,initial])),models:Object.fromEntries(fixtureCatalog.models.map(m=>[m.id,initial]))});
