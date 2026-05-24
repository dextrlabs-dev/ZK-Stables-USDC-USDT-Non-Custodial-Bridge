import type { ScenarioResult, LatencyBudgetRow } from '../types.js';
import { computeStats } from '../metrics/histogram.js';

type BudgetEntry = {
  route: string;
  phase: string;
  expectedRange: string;
  extractMs: (result: ScenarioResult) => number[];
};

const BUDGET_ENTRIES: BudgetEntry[] = [
  {
    route: 'EVM -> Midnight LOCK',
    phase: 'Finality wait',
    expectedRange: '1,000-3,000',
    extractMs: (r) => r.timelines.map(t => t.phaseDurations.awaitingFinalityMs ?? 0).filter(v => v > 0),
  },
  {
    route: 'EVM -> Midnight LOCK',
    phase: 'Proving',
    expectedRange: '100-500',
    extractMs: (r) => r.timelines.map(t => t.phaseDurations.provingMs ?? 0).filter(v => v > 0),
  },
  {
    route: 'EVM -> Midnight LOCK',
    phase: 'Destination handoff',
    expectedRange: '10,000-60,000',
    extractMs: (r) => r.timelines.map(t => t.phaseDurations.destinationHandoffMs ?? 0).filter(v => v > 0),
  },
  {
    route: 'EVM -> Midnight LOCK',
    phase: 'Total settlement',
    expectedRange: '12,000-65,000',
    extractMs: (r) => r.timelines.map(t => t.totalMs),
  },
  {
    route: 'Midnight -> EVM BURN',
    phase: 'Finality wait',
    expectedRange: '1,000-3,000',
    extractMs: (r) => r.timelines.map(t => t.phaseDurations.awaitingFinalityMs ?? 0).filter(v => v > 0),
  },
  {
    route: 'Midnight -> EVM BURN',
    phase: 'Proving',
    expectedRange: '100-500',
    extractMs: (r) => r.timelines.map(t => t.phaseDurations.provingMs ?? 0).filter(v => v > 0),
  },
  {
    route: 'Midnight -> EVM BURN',
    phase: 'Destination handoff',
    expectedRange: '15,000-90,000',
    extractMs: (r) => r.timelines.map(t => t.phaseDurations.destinationHandoffMs ?? 0).filter(v => v > 0),
  },
  {
    route: 'Midnight -> EVM BURN',
    phase: 'Total settlement',
    expectedRange: '18,000-95,000',
    extractMs: (r) => r.timelines.map(t => t.totalMs),
  },
];

export function computeLatencyBudget(
  lockResult: ScenarioResult | undefined,
  burnResult: ScenarioResult | undefined,
): LatencyBudgetRow[] {
  const rows: LatencyBudgetRow[] = [];

  for (const entry of BUDGET_ENTRIES) {
    const src = entry.route.includes('LOCK') ? lockResult : burnResult;
    if (!src) continue;

    const values = entry.extractMs(src);
    if (values.length === 0) continue;

    const stats = computeStats(values);
    const [lo, hi] = entry.expectedRange.replace(/,/g, '').split('-').map(Number);
    const withinBudget = stats.p90 >= lo && stats.p90 <= hi;

    rows.push({
      route: entry.route,
      phase: entry.phase,
      expectedRange: entry.expectedRange,
      actualP50Ms: stats.p50,
      actualP90Ms: stats.p90,
      withinBudget,
    });
  }

  return rows;
}
