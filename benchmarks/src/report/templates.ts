import type { Stats } from '../metrics/histogram.js';

export function statsRow(label: string, stats: Stats): string {
  return `| ${label} | ${fmt(stats.p50)} | ${fmt(stats.p90)} | ${fmt(stats.p99)} | ${fmt(stats.min)} | ${fmt(stats.max)} |`;
}

export function gasRow(op: string, gasUsed: bigint, gasCostWei: bigint): string {
  const ethCost = Number(gasCostWei) / 1e18;
  return `| ${op} | ${gasUsed.toLocaleString()} | ${ethCost.toFixed(6)} ETH |`;
}

export function fmt(n: number): string {
  return n.toLocaleString('en-US');
}

export function table(headers: string[], rows: string[]): string {
  const sep = headers.map(() => '---').join(' | ');
  return `| ${headers.join(' | ')} |\n| ${sep} |\n${rows.join('\n')}`;
}

export function section(title: string, content: string): string {
  return `## ${title}\n\n${content}\n`;
}
