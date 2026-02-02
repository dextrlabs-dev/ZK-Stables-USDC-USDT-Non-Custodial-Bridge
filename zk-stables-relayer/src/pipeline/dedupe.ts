import type { BridgeIntent } from '../types.js';
import { evmEventDedupeKey } from '../store.js';

export function evmDedupeKeyFromIntent(intent: BridgeIntent): string | undefined {
  const tx = intent.source?.evm?.txHash;
  const li = intent.source?.evm?.logIndex;
  if (!tx || li === undefined) return undefined;
  return evmEventDedupeKey(tx, li);
}
