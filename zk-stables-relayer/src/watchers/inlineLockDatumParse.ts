import { deserializeDatum } from '@meshsdk/core';
import type { Data } from '@meshsdk/common';
import { parseLockDatumFromMeshData } from '../adapters/cardanoAiken/cardanoLockDatum.js';

/**
 * When a lock UTxO carries an inline datum (browser lock path), parse it so stub proof
 * `lockNonce` matches `computeCardanoLockEventCommitmentDigest`.
 */
export function tryParseLockDatumFromInlineHex(
  inlineHex: string | null | undefined,
): { lockNonce: string; amountStr: string } | null {
  if (!inlineHex?.trim()) return null;
  const raw = inlineHex.trim().replace(/^0x/i, '');
  if (!raw) return null;
  try {
    const data = deserializeDatum(raw) as Data;
    const p = parseLockDatumFromMeshData(data);
    return {
      lockNonce: p.lockNonce.toString(),
      amountStr: p.amount.toString(),
    };
  } catch {
    return null;
  }
}
