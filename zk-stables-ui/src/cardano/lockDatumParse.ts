/**
 * Mirrors relayer `cardanoLockDatum.ts` — keep field order aligned with `cardano/aiken/lib/zk_stables_bridge/types.ak`.
 */
import type { Data } from '@meshsdk/common';

export type LockDatumParams = {
  depositorVkeyHashHex56: string;
  recipientVkeyHashHex56: string;
  policyIdHex: string;
  assetNameHex: string;
  amount: bigint;
  lockNonce: bigint;
  recipientCommitmentHex: string;
  sourceChainId: bigint;
  destinationChainId: bigint;
  bridgeOperatorVkeyHashHex56: string | null;
};

export function parseLockDatumFromMeshData(d: Data): LockDatumParams {
  const root = d as unknown as { alternative: number; fields: Data[] };
  const f = root.fields;
  if (!Array.isArray(f) || f.length < 10) {
    throw new Error('Unexpected LockDatum shape from chain');
  }
  const opField = f[9] as unknown as { alternative: number; fields: Data[] };
  let bridgeOperatorVkeyHashHex56: string | null = null;
  if (opField.alternative === 0 && opField.fields?.length === 1) {
    bridgeOperatorVkeyHashHex56 = String(opField.fields[0]);
  } else if (opField.alternative === 1) {
    bridgeOperatorVkeyHashHex56 = null;
  } else {
    throw new Error('Unexpected bridge_operator option in LockDatum');
  }
  return {
    depositorVkeyHashHex56: String(f[0]),
    recipientVkeyHashHex56: String(f[1]),
    policyIdHex: String(f[2]),
    assetNameHex: String(f[3]),
    amount: BigInt(String(f[4])),
    lockNonce: BigInt(String(f[5])),
    recipientCommitmentHex: String(f[6]),
    sourceChainId: BigInt(String(f[7])),
    destinationChainId: BigInt(String(f[8])),
    bridgeOperatorVkeyHashHex56,
  };
}

export function normalizeDatumRecipientCommitment(hex: string): string {
  let h = hex.replace(/^0x/i, '').trim().toLowerCase();
  if (h.length > 64) h = h.slice(0, 64);
  if (h.length !== 64 || !/^[0-9a-f]+$/u.test(h)) {
    throw new Error('datum recipient_commitment must be 64 hex chars');
  }
  return h;
}
