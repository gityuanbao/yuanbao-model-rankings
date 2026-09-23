import { z } from 'zod';
import { providerIds } from './schema';
import data from '../../data/pelican/html-submissions-2026-09-23.json';

// HTML-only submissions need neither a fabricated recording nor an AI score.
export const pelicanHtmlSchema = z.object({
  schemaVersion: z.literal(1),
  ruleVersion: z.literal('3.0'),
  receivedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  entries: z.array(z.object({
    id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    name: z.string().trim().min(1),
    providerId: z.enum(providerIds),
    sourceFile: z.string().min(1),
    artifact: z.object({
      src: z.string(), download: z.string(),
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
      zipSha256: z.string().regex(/^[a-f0-9]{64}$/),
      archiveOrigin: z.literal('packaged-original-html'),
    }).strict(),
  }).strict().superRefine((entry, ctx) => {
    if (entry.artifact.src !== `pelican-originals/${entry.id}.html.txt` || entry.artifact.download !== `pelican-originals/${entry.id}.zip`) {
      ctx.addIssue({ code: 'custom', path: ['artifact'], message: '原作路径必须与模型 ID 一致' });
    }
  })),
}).strict().superRefine((board, ctx) => {
  if (new Set(board.entries.map(entry => entry.id)).size !== board.entries.length) {
    ctx.addIssue({ code: 'custom', path: ['entries'], message: 'HTML 作品 ID 不能重复' });
  }
});

export const pelicanHtmlBoard = pelicanHtmlSchema.parse(data);
export type PelicanHtmlEntry = typeof pelicanHtmlBoard.entries[number];
