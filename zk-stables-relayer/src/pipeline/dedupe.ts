import type { BridgeIntent } from '../types.js';
import { cardanoUtxoDedupeKey, evmEventDedupeKey } from '../store.js';

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

export type BridgeDedupeKeys = { evm?: string; cardano?: string };

export function bridgeDedupeKeysFromIntent(intent: BridgeIntent): BridgeDedupeKeys {
  return {
    evm: evmDedupeKeyFromIntent(intent),
    cardano: cardanoDedupeKeyFromIntent(intent),
  };
}
