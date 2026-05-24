export type Stats = {
  min: number;
  max: number;
  avg: number;
  p50: number;
  p90: number;
  p99: number;
  count: number;
};

export function computeStats(values: number[]): Stats {
  if (values.length === 0) {
    return { min: 0, max: 0, avg: 0, p50: 0, p90: 0, p99: 0, count: 0 };
  }

  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);

  return {
    min: sorted[0],
    max: sorted[sorted.length - 1],
    avg: Math.round(sum / sorted.length),
    p50: percentile(sorted, 50),
    p90: percentile(sorted, 90),
    p99: percentile(sorted, 99),
    count: sorted.length,
  };
}

function percentile(sorted: number[], pct: number): number {
  const idx = Math.ceil((pct / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}
