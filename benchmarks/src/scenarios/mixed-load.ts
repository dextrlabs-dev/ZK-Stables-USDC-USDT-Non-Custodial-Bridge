import { config } from '../config.js';
import { MetricsCollector } from '../metrics/collector.js';
import { prepareLockIntents, prepareBurnIntents } from '../harness/intent-factory.js';
import { runLoad } from '../harness/load-runner.js';
import type { ScenarioResult } from '../types.js';

export async function runMixedLoad(): Promise<ScenarioResult> {
  const collector = new MetricsCollector();
  collector.start();

  const lockCount = Math.ceil(config.totalIntents / 2);
  const burnCount = Math.floor(config.totalIntents / 2);

  console.log(`[mixed-load] Preparing ${lockCount} LOCKs + ${burnCount} BURNs...`);
  const locks = await prepareLockIntents(lockCount, { destinationChain: 'midnight' });
  const burns = prepareBurnIntents(burnCount, { destinationChain: 'evm' });

  const allIntents: Record<string, unknown>[] = [];
  const lockTxHashes: (`0x${string}` | undefined)[] = [];
  for (let i = 0; i < Math.max(locks.length, burns.length); i++) {
    if (i < locks.length) {
      allIntents.push(locks[i]);
      lockTxHashes.push(locks[i]._lockTxHash);
    }
    if (i < burns.length) {
      allIntents.push(burns[i]);
      lockTxHashes.push(undefined);
    }
  }

  console.log(`[mixed-load] Running ${allIntents.length} mixed intents with concurrency=${config.concurrency}...`);
  const throughput = await runLoad(
    {
      intents: allIntents,
      concurrency: config.concurrency,
      measureEvmGas: true,
      lockTxHashes: lockTxHashes.filter((h): h is `0x${string}` => !!h),
    },
    collector,
  );

  console.log(`[mixed-load] Done. Completed: ${throughput.totalCompleted}/${allIntents.length}`);
  return collector.toResult('mixed-load', throughput);
}
