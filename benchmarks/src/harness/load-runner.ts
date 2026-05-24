import { submitIntent, trackJob } from './job-tracker.js';
import { MetricsCollector } from '../metrics/collector.js';
import { measureGas, extractEvmTxHashes } from '../metrics/gas.js';
import type { ThroughputMetrics } from '../types.js';

type RunLoadOpts = {
  intents: Record<string, unknown>[];
  concurrency: number;
  measureEvmGas?: boolean;
  lockTxHashes?: `0x${string}`[];
};

export async function runLoad(
  opts: RunLoadOpts,
  collector: MetricsCollector,
): Promise<ThroughputMetrics> {
  const { intents, concurrency, measureEvmGas = false, lockTxHashes = [] } = opts;
  const startTime = Date.now();
  let inFlight = 0;
  let peakInFlight = 0;
  let completed = 0;
  let failed = 0;
  let idx = 0;

  const submissionTimes: number[] = [];

  const semaphore = async (fn: () => Promise<void>) => {
    while (inFlight >= concurrency) {
      await new Promise(r => setTimeout(r, 50));
    }
    inFlight++;
    peakInFlight = Math.max(peakInFlight, inFlight);
    try {
      await fn();
    } finally {
      inFlight--;
    }
  };

  const tasks = intents.map((intent, i) =>
    semaphore(async () => {
      try {
        const submission = await submitIntent(intent);
        submissionTimes.push(submission.respondedAt - submission.submittedAt);

        const result = await trackJob(submission.jobId);
        collector.addTimeline(result);

        if (result.finalPhase === 'completed') {
          completed++;
          if (measureEvmGas) {
            const hashes = extractEvmTxHashes(result.job.destinationHint);
            for (const h of hashes) {
              try {
                const gas = await measureGas('destination_tx', h);
                collector.addGas(gas);
              } catch {}
            }
          }
          if (lockTxHashes[i]) {
            try {
              const gas = await measureGas('pool_lock', lockTxHashes[i]);
              collector.addGas(gas);
            } catch {}
          }
        } else {
          failed++;
          collector.addError(`Job ${submission.jobId}: ${result.job.error}`);
        }
      } catch (e) {
        failed++;
        collector.addError(`Intent ${i}: ${(e as Error).message}`);
      }
    }),
  );

  await Promise.allSettled(tasks);

  const totalDuration = Date.now() - startTime;

  return {
    totalSubmitted: intents.length,
    totalCompleted: completed,
    totalFailed: failed,
    submissionRps: intents.length / (totalDuration / 1000),
    completionRps: completed / (totalDuration / 1000),
    peakConcurrentInFlight: peakInFlight,
  };
}
