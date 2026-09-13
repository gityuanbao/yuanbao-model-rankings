import data from '../data/catalog.json';
import exchange from '../data/exchange-rates.json';
import verificationData from '../data/verification.json';
import { catalogSchema } from './schema';
import { exchangeRateSchema, verificationFileSchema } from './pricing-metadata';
const rate = exchangeRateSchema.parse(exchange);
export const verification = verificationFileSchema.parse(verificationData);
export const catalog = catalogSchema.parse({
  ...data,
  meta: { ...data.meta, usdToCny: rate.rate, exchangeRateNote: rate.note },
  models: data.models.map(model => ({ ...model, verification: verification.models[model.id] })),
});
