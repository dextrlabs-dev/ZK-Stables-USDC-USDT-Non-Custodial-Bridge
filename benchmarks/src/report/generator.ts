import { writeFile } from 'node:fs/promises';
import type { BenchmarkReport, ScenarioResult } from '../types.js';
import { computeStats, type Stats } from '../metrics/histogram.js';
import { computeLatencyBudget } from './latency-budget.js';
import { fmt, section } from './templates.js';
import { config } from '../config.js';

export async function generateReport(scenarios: ScenarioResult[]): Promise<void> {
  const report: BenchmarkReport = {
    generatedAt: new Date().toISOString(),
    environment: {
      relayerUrl: config.relayerUrl,
      evmRpcUrl: config.evmRpcUrl,
      yaciUrl: config.yaciUrl,
      concurrency: config.concurrency,
      pollMs: config.pollMs,
    },
    scenarios,
  };

  const md = buildMarkdown(report);
  await writeFile(config.reportPath, md, 'utf-8');
  console.log(`\nReport written to ${config.reportPath}`);

  const jsonStr = JSON.stringify(report, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2);
  await writeFile(config.reportJson, jsonStr, 'utf-8');
  console.log(`Raw data written to ${config.reportJson}`);
}

function buildMarkdown(report: BenchmarkReport): string {
  const parts: string[] = [];

  parts.push(`# ZK-Stables Benchmark Report\n`);
  parts.push(`**Generated:** ${report.generatedAt}\n`);
  parts.push(`**Environment:** Relayer \`${report.environment.relayerUrl}\`, EVM RPC \`${report.environment.evmRpcUrl}\`\n`);
  parts.push(`**Config:** concurrency=${report.environment.concurrency}, poll_interval=${report.environment.pollMs}ms\n`);

  // Summary table
  parts.push(section('Summary', buildSummaryTable(report.scenarios)));

  // Per-scenario details
  for (const sc of report.scenarios) {
    parts.push(section(`Scenario: ${sc.name}`, buildScenarioDetail(sc)));
  }

  // Gas costs
  const allGas = report.scenarios.flatMap(s => s.gasMeasurements);
  if (allGas.length > 0) {
    parts.push(section('EVM Gas Costs', buildGasTable(allGas)));
  }

  // Settlement latency budget
  const lockResult = report.scenarios.find(s => s.name.includes('lock') && !s.name.includes('concurrent'));
  const burnResult = report.scenarios.find(s => s.name.includes('burn'));
  const budget = computeLatencyBudget(lockResult, burnResult);
  if (budget.length > 0) {
    parts.push(section('Settlement Latency Budget', buildBudgetTable(budget)));
  }

  // Throughput
  const throughputScenarios = report.scenarios.filter(s => s.throughput);
  if (throughputScenarios.length > 0) {
    parts.push(section('Throughput', buildThroughputTable(throughputScenarios)));
  }

  // Errors
  const allErrors = report.scenarios.flatMap(s => s.errors);
  if (allErrors.length > 0) {
    parts.push(section('Errors', allErrors.map(e => `- ${e}`).join('\n')));
  }

  // Methodology
  parts.push(section('Methodology', [
    'Benchmarks are run against a local devnet stack (Anvil for EVM, optional Yaci for Cardano, local Midnight proof server).',
    `Phase transitions are detected by polling \`GET /v1/jobs/:id\` at ${report.environment.pollMs}ms intervals.`,
    'Measurement error per phase transition is bounded by the poll interval.',
    'EVM gas costs reflect Solidity execution cost on Anvil; dollar costs require mainnet gas price extrapolation.',
    `Raw benchmark data is saved to \`${config.reportJson}\` for post-processing.`,
  ].join('\n\n')));

  return parts.join('\n');
}

function buildSummaryTable(scenarios: ScenarioResult[]): string {
  const headers = '| Scenario | Jobs | Completed | Failed | p50 (ms) | p90 (ms) | p99 (ms) | Duration |';
  const sep =     '| --- | --- | --- | --- | --- | --- | --- | --- |';
  const rows = scenarios.map(sc => {
    const totals = sc.timelines.map(t => t.totalMs);
    const stats = computeStats(totals);
    const completed = sc.timelines.filter(t => t.finalPhase === 'completed').length;
    const failed = sc.timelines.filter(t => t.finalPhase === 'failed').length;
    return `| ${sc.name} | ${sc.timelines.length} | ${completed} | ${failed} | ${fmt(stats.p50)} | ${fmt(stats.p90)} | ${fmt(stats.p99)} | ${(sc.durationMs / 1000).toFixed(1)}s |`;
  });
  return `${headers}\n${sep}\n${rows.join('\n')}`;
}

function buildScenarioDetail(sc: ScenarioResult): string {
  const parts: string[] = [];

  if (sc.timelines.length === 0) {
    parts.push('No completed jobs to analyze.');
    return parts.join('\n');
  }

  const phases: { label: string; extract: (t: (typeof sc.timelines)[0]) => number | undefined }[] = [
    { label: 'Finality wait', extract: t => t.phaseDurations.awaitingFinalityMs },
    { label: 'Proving', extract: t => t.phaseDurations.provingMs },
    { label: 'Destination handoff', extract: t => t.phaseDurations.destinationHandoffMs },
    { label: '**Total settlement**', extract: t => t.totalMs },
  ];

  const headers = '| Phase | p50 (ms) | p90 (ms) | p99 (ms) | min (ms) | max (ms) |';
  const sep =     '| --- | --- | --- | --- | --- | --- |';
  const rows: string[] = [];

  for (const p of phases) {
    const values = sc.timelines.map(t => p.extract(t)).filter((v): v is number => v !== undefined && v > 0);
    if (values.length === 0) continue;
    const stats = computeStats(values);
    rows.push(`| ${p.label} | ${fmt(stats.p50)} | ${fmt(stats.p90)} | ${fmt(stats.p99)} | ${fmt(stats.min)} | ${fmt(stats.max)} |`);
  }

  parts.push(`${headers}\n${sep}\n${rows.join('\n')}`);
  return parts.join('\n\n');
}

function buildGasTable(measurements: BenchmarkReport['scenarios'][0]['gasMeasurements']): string {
  const headers = '| Operation | Gas Used | Cost (ETH) | Tx Hash |';
  const sep =     '| --- | --- | --- | --- |';
  const rows = measurements.map(m => {
    const ethCost = Number(m.gasCostWei) / 1e18;
    return `| ${m.operation} | ${m.gasUsed.toLocaleString()} | ${ethCost.toFixed(6)} | \`${m.txHash.slice(0, 10)}...\` |`;
  });
  return `${headers}\n${sep}\n${rows.join('\n')}\n\n*Gas prices are synthetic (Anvil default). gasUsed reflects actual Solidity execution cost.*`;
}

function buildBudgetTable(rows: ReturnType<typeof computeLatencyBudget>): string {
  const headers = '| Route | Phase | Expected (ms) | Actual p50 (ms) | Actual p90 (ms) | Within Budget |';
  const sep =     '| --- | --- | --- | --- | --- | --- |';
  const tableRows = rows.map(r =>
    `| ${r.route} | ${r.phase} | ${r.expectedRange} | ${fmt(r.actualP50Ms)} | ${fmt(r.actualP90Ms)} | ${r.withinBudget ? 'Yes' : '**No**'} |`
  );
  return `${headers}\n${sep}\n${tableRows.join('\n')}`;
}

function buildThroughputTable(scenarios: ScenarioResult[]): string {
  const headers = '| Scenario | Submitted | Completed | Failed | Submission RPS | Completion RPS | Peak In-Flight |';
  const sep =     '| --- | --- | --- | --- | --- | --- | --- |';
  const rows = scenarios.map(sc => {
    const t = sc.throughput!;
    return `| ${sc.name} | ${t.totalSubmitted} | ${t.totalCompleted} | ${t.totalFailed} | ${t.submissionRps.toFixed(2)} | ${t.completionRps.toFixed(2)} | ${t.peakConcurrentInFlight} |`;
  });
  return `${headers}\n${sep}\n${rows.join('\n')}`;
}
