import { createHash } from 'node:crypto';
import type { Catalog, Model } from '../../src/lib/schema';
import { isOfficialUrl } from '../../src/lib/schema';

export interface Snapshot { url: string; sha256: string; text: string }
export interface SourceResult { id: string; status: 'unchanged' | 'changed' | 'initial' | 'failed'; snapshot?: Snapshot; previous?: Snapshot; error?: string; missingModels?: string[] }
export function normalizePage(html: string) {
  const main = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1] ?? html;
  return main.replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<!--[^]*?-->/g, '').replace(/<\/(?:p|div|h[1-6]|tr|li|section)>/gi, '\n')
    .replace(/<\/(?:td|th)>/gi, ' | ').replace(/<[^>]+>/g, ' ')
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, value: string) => {
      const code = value[0].toLowerCase() === 'x' ? parseInt(value.slice(1), 16) : Number(value);
      return code <= 0x10ffff ? String.fromCodePoint(code) : '';
    })
    .replace(/&(nbsp|amp|lt|gt|quot|apos|yen|dollar);/g, (_, key: string) => ({ nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", yen: '¥', dollar: '$' })[key]!)
    .split('\n').map(line => line.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
}
const normalizedName = (value: string) => value.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g, '');
export async function checkSource(source: Catalog['sources'][number], models: Model[], previous?: Snapshot, fetcher: typeof fetch = fetch): Promise<SourceResult> {
  try {
    let url = source.url;
    let response: Response | undefined;
    const signal = AbortSignal.timeout(25_000);
    for (let redirects = 0; redirects < 5; redirects++) {
      if (!isOfficialUrl(url, source.providerId)) throw new Error('拒绝非官方域名及跨厂商重定向');
      response = await fetcher(url, { redirect: 'manual', signal, headers: { 'User-Agent': 'Yuanbao-Price-Monitor/1.0 (+manual-review-required)', Accept: 'text/html,text/plain' } });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) throw new Error('重定向缺少目标');
        url = new URL(location, url).href;
      } else break;
    }
    if (!response?.ok) throw new Error(`请求失败 HTTP ${response?.status ?? 'unknown'}`);
    if (Number(response.headers.get('content-length')) > 5_000_000) throw new Error('页面过大，需人工核对');
    const html = await response.text();
    if (html.length > 5_000_000) throw new Error('页面过大，需人工核对');
    const text = normalizePage(html);
    if (text.length < 150 || /^(just a moment|access denied|verify you are human)/i.test(text)) throw new Error('未获取到可核验的定价正文（空页、动态页面或访问限制）');
    const normalized = normalizedName(text);
    const missingModels = models.filter(model => !normalized.includes(normalizedName(model.apiId)) && !normalized.includes(normalizedName(model.name))).map(model => model.id);
    if (missingModels.length === models.length) throw new Error('正文未包含任何已收录模型，保留旧快照和旧价格');
    const sha256 = createHash('sha256').update(text).digest('hex');
    const snapshot = { url, sha256, text };
    return { id: source.id, status: previous ? previous.sha256 === sha256 ? 'unchanged' : 'changed' : 'initial', snapshot, previous, missingModels };
  } catch (error) { return { id: source.id, status: 'failed', previous, error: error instanceof Error ? error.message : String(error) }; }
}
export function readableDiff(before: string, after: string) {
  const oldLines = before.split('\n'), newLines = after.split('\n');
  const oldSet = new Set(oldLines), newSet = new Set(newLines);
  const lines = [...oldLines.filter(line => !newSet.has(line)).map(line => `- ${line}`), ...newLines.filter(line => !oldSet.has(line)).map(line => `+ ${line}`)];
  if (!lines.length && before !== after) return '正文行顺序或重复行数量有变化，请比较快照文件。';
  return lines.slice(0, 200).join('\n') + (lines.length > 200 ? '\n… 完整差异请查看候选快照文件。' : '');
}
