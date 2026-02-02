import { createHash } from 'node:crypto';
import type { BridgeIntent } from '../types.js';

/** Architecture PDF: ZK circuit proves header finality + event inclusion. Until circuits ship, we bind intent to a deterministic digest. */
export function buildStubProofBundle(intent: BridgeIntent, lockRef: string): {
  algorithm: 'stub-sha256-v1';
  digest: string;
  publicInputsHex: string;
} {
  const payload = JSON.stringify({
    lockRef,
    operation: intent.operation,
    sourceChain: intent.sourceChain,
    assetKind: intent.assetKind,
    amount: intent.amount,
    recipient: intent.recipient,
  });
  const digest = createHash('sha256').update(payload).digest('hex');
  const publicInputsHex = createHash('sha256').update(`${digest}:public`).digest('hex');
  return {
    algorithm: 'stub-sha256-v1',
    digest,
    publicInputsHex,
  };
}
