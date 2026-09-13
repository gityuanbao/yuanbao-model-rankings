import { z } from 'zod';
import { providerIds, type Catalog } from './schema';
import { modelSearch } from './search';

export const pelicanTiers = [
  { id: 'hang', label: '夯' },
  { id: 'top', label: '顶级' },
  { id: 'good', label: '人上人' },
  { id: 'npc', label: 'NPC' },
  { id: 'la', label: '拉' },
] as const;

const entrySchema = z.object({
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  name: z.string().trim().min(1),
  providerId: z.enum(providerIds),
  tier: z.enum(['hang', 'top', 'good', 'npc', 'la']),
  order: z.number().int().positive(),
  gif: z.string().regex(/^media\/pelican\/[a-z0-9]+(?:-[a-z0-9]+)*\.gif$/, 'GIF 使用 public/media/pelican/ 下的本地文件'),
}).strict();

export const pelicanSchema = z.object({
  schemaVersion: z.literal(1),
  entries: z.array(entrySchema),
}).strict().superRefine((data, ctx) => {
  const ids = new Set<string>();
  const positions = new Set<string>();
  data.entries.forEach((entry, index) => {
    if (ids.has(entry.id)) ctx.addIssue({ code: 'custom', path: ['entries', index, 'id'], message: '测试条目 ID 不能重复' });
    const position = `${entry.tier}:${entry.order}`;
    if (positions.has(position)) ctx.addIssue({ code: 'custom', path: ['entries', index, 'order'], message: '同一档位内的排序不能重复' });
    ids.add(entry.id);
    positions.add(position);
  });
});

export type PelicanBoard = z.infer<typeof pelicanSchema>;
export type PelicanEntry = PelicanBoard['entries'][number];

export interface PelicanFilters { providers: string[]; query: string; order: 'asc' | 'desc' }
export const defaultPelicanFilters: PelicanFilters = { providers: [], query: '', order: 'desc' };

export function parsePelicanFilters(search: string): PelicanFilters {
  const params = new URLSearchParams(search);
  return {
    order: params.get('order') === 'asc' ? 'asc' : 'desc',
    query: (params.get('q') ?? '').trim().slice(0, 100),
    providers: [...new Set((params.get('providers') ?? '').split(',').filter(id => providerIds.includes(id as typeof providerIds[number])))].sort(),
  };
}

export function serializePelicanFilters(filters: PelicanFilters) {
  const params = new URLSearchParams();
  if (filters.order === 'asc') params.set('order', 'asc');
  if (filters.providers.length) params.set('providers', [...filters.providers].sort().join(','));
  if (filters.query) params.set('q', filters.query);
  return params.size ? `?${params}` : '';
}

export function getPelicanTiers(board: PelicanBoard) {
  return pelicanTiers.map(tier => ({
    ...tier,
    entries: board.entries.filter(entry => entry.tier === tier.id).sort((a, b) => a.order - b.order),
  }));
}

export function getPelicanRows(board: PelicanBoard, catalog: Catalog, filters: PelicanFilters) {
  const matches = modelSearch(filters.query);
  const rows = getPelicanTiers(board).flatMap(tier => tier.entries).filter(entry => {
    const provider = catalog.providers.find(item => item.id === entry.providerId)!;
    return (!filters.providers.length || filters.providers.includes(entry.providerId)) &&
      matches(entry.name, provider.name, provider.shortName, entry.providerId);
  });
  return filters.order === 'asc' ? rows.reverse() : rows;
}

export function getPelicanLeaders(rows: PelicanEntry[]) {
  const tierIndex = (entry: PelicanEntry) => pelicanTiers.findIndex(tier => tier.id === entry.tier);
  return [...rows].sort((a, b) => tierIndex(a) - tierIndex(b) || a.order - b.order).slice(0, 3);
}
