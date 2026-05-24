import { config } from '../config.js';
import type { RelayerPhase, PhaseObservation, JobTimeline, PhaseDurations } from '../types.js';

type RelayerJob = {
  id: string;
  phase: RelayerPhase;
  createdAt: string;
  updatedAt: string;
  destinationHint?: string;
  depositCommitmentHex?: string;
  error?: string;
};

export async function trackJob(jobId: string): Promise<JobTimeline & { job: RelayerJob }> {
  const observations: PhaseObservation[] = [];
  let lastPhase: RelayerPhase | null = null;
  const startTime = Date.now();
  let finalJob: RelayerJob | null = null;

  while (Date.now() - startTime < config.jobTimeoutMs) {
    const resp = await fetch(`${config.relayerUrl}/v1/jobs/${encodeURIComponent(jobId)}`);
    if (!resp.ok) throw new Error(`Job fetch failed: ${resp.status}`);
    const job = (await resp.json()) as RelayerJob;

    if (job.phase !== lastPhase) {
      observations.push({ jobId, phase: job.phase, observedAt: Date.now() });
      lastPhase = job.phase;
    }

    if (job.phase === 'completed' || job.phase === 'failed') {
      finalJob = job;
      break;
    }

    await new Promise(r => setTimeout(r, config.pollMs));
  }

  if (!finalJob) throw new Error(`Job ${jobId} timed out after ${config.jobTimeoutMs}ms`);

  const createdAt = new Date(finalJob.createdAt).getTime();
  const phaseDurations = computePhaseDurations(observations);
  const totalMs = observations[observations.length - 1].observedAt - (observations[0]?.observedAt ?? createdAt);

  return {
    jobId,
    createdAt,
    observations,
    finalPhase: finalJob.phase as 'completed' | 'failed',
    phaseDurations,
    totalMs,
    job: finalJob,
  };
}

function computePhaseDurations(obs: PhaseObservation[]): PhaseDurations {
  const durations: PhaseDurations = {};
  for (let i = 0; i < obs.length - 1; i++) {
    const dur = obs[i + 1].observedAt - obs[i].observedAt;
    switch (obs[i].phase) {
      case 'received': durations.receivedMs = dur; break;
      case 'awaiting_finality': durations.awaitingFinalityMs = dur; break;
      case 'proving': durations.provingMs = dur; break;
      case 'destination_handoff': durations.destinationHandoffMs = dur; break;
    }
  }
  return durations;
}

export async function submitIntent(
  intent: Record<string, unknown>,
): Promise<{ jobId: string; submittedAt: number; respondedAt: number }> {
  const op = intent.operation as string;
  const ep = op === 'LOCK' ? '/v1/intents/lock' : '/v1/intents/burn';
  const submittedAt = Date.now();

  const resp = await fetch(`${config.relayerUrl}${ep}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(intent),
  });

  const respondedAt = Date.now();
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Intent submission failed (${resp.status}): ${text}`);
  }

  const data = (await resp.json()) as { jobId: string };
  return { jobId: data.jobId, submittedAt, respondedAt };
}
