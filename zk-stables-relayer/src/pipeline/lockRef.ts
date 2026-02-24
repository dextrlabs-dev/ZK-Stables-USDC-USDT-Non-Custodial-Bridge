import { createHash, randomBytes } from 'node:crypto';
import type { BridgeIntent } from '../types.js';

/**
 * Stable job anchor for proof binding (stub JSON) and UI display.
 * - On-chain sources: same shape as dedupe keys (`evm:tx:logIndex`, `cardano:tx:out`).
 * - API / manual intents without `source`: `offchain:<sha256-prefix>:<unique>`.
 */
export function buildLockRefFromIntent(intent: BridgeIntent): string {
  const ev = intent.source?.evm;
  if (ev?.txHash && ev.logIndex !== undefined) {
    return `evm:${String(ev.txHash).toLowerCase()}:${ev.logIndex}`;
  }
  const c = intent.source?.cardano;
  if (c?.txHash && c.outputIndex !== undefined) {
    return `cardano:${c.txHash}:${c.outputIndex}`;
  }
  const basis = JSON.stringify({
    op: intent.operation,
    src: intent.sourceChain,
    dst: intent.destinationChain ?? '',
    amount: intent.amount,
    recipient: intent.recipient,
    assetKind: intent.assetKind,
  });
  const h = createHash('sha256').update(basis).digest('hex').slice(0, 32);
  return `offchain:${h}:${randomBytes(6).toString('hex')}`;
}
