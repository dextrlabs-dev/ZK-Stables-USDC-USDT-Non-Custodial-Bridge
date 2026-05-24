import { MetricsCollector } from '../metrics/collector.js';
import { prepareBurnIntents } from '../harness/intent-factory.js';
import { submitIntent, trackJob } from '../harness/job-tracker.js';
import { measureGas, extractEvmTxHashes } from '../metrics/gas.js';
import type { ScenarioResult } from '../types.js';

export async function runSingleBurn(): Promise<ScenarioResult> {
  const collector = new MetricsCollector();
  collector.start();

  console.log('[single-burn] Preparing 1 BURN intent (Midnight -> EVM)...');
  const [intent] = prepareBurnIntents(1, { destinationChain: 'evm' });

  console.log('[single-burn] Submitting intent...');
  const { jobId } = await submitIntent(intent);

  console.log(`[single-burn] Tracking job ${jobId}...`);
  const result = await trackJob(jobId);
  collector.addTimeline(result);

  if (result.finalPhase === 'completed') {
    const hashes = extractEvmTxHashes(result.job.destinationHint);
    for (const h of hashes) {
      try {
        const gas = await measureGas('evm_unlock', h);
        collector.addGas(gas);
      } catch {}
    }
  } else {
    collector.addError(`Job ${jobId} failed: ${result.job.error}`);
  }

  console.log(`[single-burn] Done. Phase: ${result.finalPhase}, Total: ${result.totalMs}ms`);
  return collector.toResult('single-burn');
}
