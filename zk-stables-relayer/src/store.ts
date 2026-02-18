import type { RelayerJob } from './types.js';

const jobs = new Map<string, RelayerJob>();
/** Deduplicate watcher-driven jobs (e.g. same burn log on relayer restart). */
const processedEvmEvents = new Set<string>();
const inflightEvmKeys = new Set<string>();
/** Same pattern for Cardano lock UTxo anchors: `cardano:txHash:outputIndex`. */
const processedCardanoUtxos = new Set<string>();
const inflightCardanoKeys = new Set<string>();

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

export function cardanoUtxoDedupeKey(txHash: string, outputIndex: number): string {
  return `cardano:${txHash}:${outputIndex}`;
}

export function isCardanoUtxoProcessed(key: string): boolean {
  return processedCardanoUtxos.has(key);
}

export function markCardanoUtxoProcessed(key: string): void {
  processedCardanoUtxos.add(key);
}

export function reserveCardanoUtxo(key: string): boolean {
  if (processedCardanoUtxos.has(key)) return false;
  if (inflightCardanoKeys.has(key)) return false;
  inflightCardanoKeys.add(key);
  return true;
}

export function releaseCardanoUtxo(key: string): void {
  inflightCardanoKeys.delete(key);
}

export function isCardanoUtxoInflightOrDone(key: string): boolean {
  return processedCardanoUtxos.has(key) || inflightCardanoKeys.has(key);
}
