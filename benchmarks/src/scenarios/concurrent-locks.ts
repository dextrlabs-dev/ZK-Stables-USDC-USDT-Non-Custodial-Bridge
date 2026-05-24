import { config } from '../config.js';
import { MetricsCollector } from '../metrics/collector.js';
import { prepareLockIntents } from '../harness/intent-factory.js';
import { runLoad } from '../harness/load-runner.js';
import type { ScenarioResult } from '../types.js';

export async function runConcurrentLocks(): Promise<ScenarioResult> {
  const collector = new MetricsCollector();
  collector.start();

  const count = config.totalIntents;
  const concurrency = config.concurrency;

  console.log(`[concurrent-locks] Preparing ${count} EVM LOCK intents...`);
  const intents = await prepareLockIntents(count, { destinationChain: 'midnight' });

  console.log(`[concurrent-locks] Running ${count} intents with concurrency=${concurrency}...`);
  const throughput = await runLoad(
    {
      intents,
      concurrency,
      measureEvmGas: true,
      lockTxHashes: intents.map(i => i._lockTxHash),
    },
    collector,
  );

  console.log(`[concurrent-locks] Done. Completed: ${throughput.totalCompleted}/${count}, RPS: ${throughput.completionRps.toFixed(2)}`);
  return collector.toResult('concurrent-locks', throughput);
}
