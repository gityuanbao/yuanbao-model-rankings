import { parseFragment } from 'parse5';
import { text } from './shared';

// Read table data only. MDX components and downloaded JavaScript are never executed.
export function markdownTables(body: string): string[][][] {
  const result: string[][][] = [];
  const lines = body.split(/\r?\n/);
  const cells = (line: string) => line.trim().slice(1, -1).split(/(?<!\\)\|/).map(value =>
    text(parseFragment(value.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/\\([\[\]\-_|])/g, '$1').replace(/\*\*|`/g, ''))).trim());
  for (let i = 0; i < lines.length - 1; i++) {
    if (!/^\s*\|.*\|\s*$/.test(lines[i]) || !/^\s*\|(?:\s*:?-+:?\s*\|)+\s*$/.test(lines[i + 1])) continue;
    const table = [cells(lines[i])];
    i += 2;
    while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
      const row = cells(lines[i]);
      if (row.length !== table[0].length) throw new Error('Markdown 价格表列数变化');
      table.push(row); i++;
    }
    result.push(table); i--;
  }
  return result;
}

export const rateLabel = (upper: number) => `输入不超过 ${upper.toLocaleString('en-US')} Token`;
