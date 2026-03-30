import type { BridgeIntent, BurnIntent, RelayerJob } from '../types.js';
import { cardanoUtxoDedupeKey, evmEventDedupeKey, listJobs } from '../store.js';

export function evmDedupeKeyFromIntent(intent: BridgeIntent): string | undefined {
  const tx = intent.source?.evm?.txHash;
  const li = intent.source?.evm?.logIndex;
  if (!tx || li === undefined) return undefined;
  return evmEventDedupeKey(tx, li);
}

export function cardanoDedupeKeyFromIntent(intent: BridgeIntent): string | undefined {
  const c = intent.source?.cardano;
  if (!c?.txHash || c.outputIndex === undefined) return undefined;
  return cardanoUtxoDedupeKey(c.txHash, c.outputIndex);
}

export function burnCommitmentDedupeKey(intent: BridgeIntent): string | undefined {
  if (intent.operation !== 'BURN') return undefined;
  const bc = (intent as BurnIntent).burnCommitmentHex?.replace(/^0x/i, '').trim().toLowerCase();
  if (!bc || bc.length !== 64 || !/^[0-9a-f]+$/u.test(bc)) return undefined;
  return bc;
}

export type BridgeDedupeKeys = { evm?: string; cardano?: string; burnCommitment?: string };

export function bridgeDedupeKeysFromIntent(intent: BridgeIntent): BridgeDedupeKeys {
  return {
    evm: evmDedupeKeyFromIntent(intent),
    cardano: cardanoDedupeKeyFromIntent(intent),
    burnCommitment: burnCommitmentDedupeKey(intent),
  };
}

/** Same anchor as `RELAYER_EVM_LOCK_ADDRESS` watcher — HTTP confirm replays must resolve to this job, not 409. */
export function findExistingJobForEvmDedupeKey(key: string): RelayerJob | undefined {
  for (const j of listJobs()) {
    const k = evmDedupeKeyFromIntent(j.intent);
    if (k === key) return j;
  }
  return undefined;
}
