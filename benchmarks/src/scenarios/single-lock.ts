import { MetricsCollector } from '../metrics/collector.js';
import { prepareLockIntents } from '../harness/intent-factory.js';
import { submitIntent, trackJob } from '../harness/job-tracker.js';
import { measureGas, extractEvmTxHashes } from '../metrics/gas.js';
import type { ScenarioResult } from '../types.js';

export async function runSingleLock(): Promise<ScenarioResult> {
  const collector = new MetricsCollector();
  collector.start();

  console.log('[single-lock] Preparing 1 EVM LOCK intent...');
  const [intent] = await prepareLockIntents(1, { destinationChain: 'midnight' });

  try {
    const lockGas = await measureGas('pool_lock', intent._lockTxHash);
    collector.addGas(lockGas);
  } catch {}

  console.log('[single-lock] Submitting intent...');
  const { jobId } = await submitIntent(intent);

  console.log(`[single-lock] Tracking job ${jobId}...`);
  const result = await trackJob(jobId);
  collector.addTimeline(result);

  if (result.finalPhase === 'completed') {
    const hashes = extractEvmTxHashes(result.job.destinationHint);
    for (const h of hashes) {
      try {
        const gas = await measureGas('destination_mint', h);
        collector.addGas(gas);
      } catch {}
    }
  } else {
    collector.addError(`Job ${jobId} failed: ${result.job.error}`);
  }

  console.log(`[single-lock] Done. Phase: ${result.finalPhase}, Total: ${result.totalMs}ms`);
  return collector.toResult('single-lock');
}
