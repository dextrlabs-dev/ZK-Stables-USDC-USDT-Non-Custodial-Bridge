#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { config } from './config.js';
import { generateReport } from './report/generator.js';
import { runSingleLock } from './scenarios/single-lock.js';
import { runSingleBurn } from './scenarios/single-burn.js';
import { runConcurrentLocks } from './scenarios/concurrent-locks.js';
import { runMixedLoad } from './scenarios/mixed-load.js';
import type { ScenarioResult } from './types.js';

const SCENARIOS: Record<string, () => Promise<ScenarioResult>> = {
  'single-lock': runSingleLock,
  'single-burn': runSingleBurn,
  'concurrent-locks': runConcurrentLocks,
  'mixed-load': runMixedLoad,
};

const { values: args } = parseArgs({
  options: {
    scenario: { type: 'string', default: 'single-lock' },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

if (args.help) {
  console.log(`
ZK-Stables Benchmark CLI

Usage:
  npx tsx benchmarks/src/cli.ts --scenario <name>[,<name>,...]

Scenarios:
  single-lock       1 EVM->Midnight LOCK (default)
  single-burn       1 Midnight->EVM BURN
  concurrent-locks  N concurrent LOCKs (set BENCH_TOTAL_INTENTS, BENCH_CONCURRENCY)
  mixed-load        Interleaved LOCKs + BURNs
  all               Run all scenarios

Environment variables:
  BENCH_RELAYER_URL       Relayer endpoint (default: http://127.0.0.1:8787)
  BENCH_EVM_RPC_URL       Anvil RPC (default: http://127.0.0.1:8545)
  BENCH_YACI_URL          Yaci Store URL for Cardano cost queries
  BENCH_CONCURRENCY       Max parallel intents (default: 5)
  BENCH_TOTAL_INTENTS     Total intents for load scenarios (default: 20)
  BENCH_POLL_MS           Job poll interval in ms (default: 200)
  BENCH_JOB_TIMEOUT_MS    Max wait per job in ms (default: 300000)
  BENCH_REPORT_PATH       Output Markdown path (default: docs/BENCHMARK_REPORT.md)
  BENCH_REPORT_JSON       Output JSON path (default: /tmp/zk-stables-benchmark.json)
`);
  process.exit(0);
}

async function main() {
  const scenarioNames = args.scenario === 'all'
    ? Object.keys(SCENARIOS)
    : (args.scenario || 'single-lock').split(',').map(s => s.trim());

  console.log(`ZK-Stables Benchmark`);
  console.log(`Relayer: ${config.relayerUrl}`);
  console.log(`EVM RPC: ${config.evmRpcUrl}`);
  console.log(`Scenarios: ${scenarioNames.join(', ')}\n`);

  // Verify relayer is reachable
  try {
    const health = await fetch(`${config.relayerUrl}/v1/health/chains`);
    if (!health.ok) throw new Error(`HTTP ${health.status}`);
    console.log('Relayer health: OK\n');
  } catch (e) {
    console.error(`Cannot reach relayer at ${config.relayerUrl}: ${(e as Error).message}`);
    console.error('Start the local stack first: ./scripts/start-local-stack.sh');
    process.exit(1);
  }

  const results: ScenarioResult[] = [];

  for (const name of scenarioNames) {
    const runner = SCENARIOS[name];
    if (!runner) {
      console.error(`Unknown scenario: ${name}. Available: ${Object.keys(SCENARIOS).join(', ')}`);
      process.exit(1);
    }

    console.log(`\n${'='.repeat(60)}`);
    console.log(`Running scenario: ${name}`);
    console.log(`${'='.repeat(60)}\n`);

    try {
      const result = await runner();
      results.push(result);
    } catch (e) {
      console.error(`Scenario ${name} failed: ${(e as Error).message}`);
      results.push({
        name,
        startedAt: new Date().toISOString(),
        durationMs: 0,
        timelines: [],
        gasMeasurements: [],
        cardanoCosts: [],
        errors: [(e as Error).message],
      });
    }
  }

  await generateReport(results);
  console.log('\nBenchmark complete.');
}

main().catch(e => { console.error(e); process.exit(1); });
