import type { RelayerJob } from './types.js';

const jobs = new Map<string, RelayerJob>();
/** Deduplicate watcher-driven jobs (e.g. same burn log on relayer restart). */
const processedEvmEvents = new Set<string>();
const inflightEvmKeys = new Set<string>();

export function saveJob(job: RelayerJob): void {
  jobs.set(job.id, job);
}

export function getJob(id: string): RelayerJob | undefined {
  return jobs.get(id);
}

export function listJobs(): RelayerJob[] {
  return [...jobs.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export function patchJob(id: string, patch: Partial<RelayerJob>): RelayerJob | undefined {
  const j = jobs.get(id);
  if (!j) return undefined;
  const next = { ...j, ...patch, updatedAt: new Date().toISOString() };
  jobs.set(id, next);
  return next;
}

export function evmEventDedupeKey(txHash: string, logIndex: number | bigint): string {
  return `evm:${txHash}:${logIndex.toString()}`;
}

export function isEvmEventProcessed(key: string): boolean {
  return processedEvmEvents.has(key);
}

export function markEvmEventProcessed(key: string): void {
  processedEvmEvents.add(key);
}

export function reserveEvmEvent(key: string): boolean {
  if (processedEvmEvents.has(key)) return false;
  if (inflightEvmKeys.has(key)) return false;
  inflightEvmKeys.add(key);
  return true;
}

export function releaseEvmEvent(key: string): void {
  inflightEvmKeys.delete(key);
}
