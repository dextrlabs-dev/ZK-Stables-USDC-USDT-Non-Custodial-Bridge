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

/** Mesh `Data` uses `alternative`; `deserializeDatum` / CSL `parseDatumCbor` returns JSON Plutus (`constructor`, `bytes`, `int`). */
function readHexBytesField(field: unknown): string {
  if (typeof field === 'string') return field.replace(/^0x/i, '').trim().toLowerCase();
  if (field && typeof field === 'object' && 'bytes' in field) {
    return String((field as { bytes: string }).bytes).toLowerCase();
  }
  throw new Error('Expected hex string or { bytes } Plutus field');
}

function readBigIntField(field: unknown): bigint {
  if (typeof field === 'bigint') return field;
  if (typeof field === 'number') {
    if (!Number.isFinite(field)) throw new Error('Plutus integer field is not a finite number');
    return BigInt(Math.trunc(field));
  }
  if (field && typeof field === 'object' && 'int' in field) {
    return readBigIntField((field as { int: unknown }).int);
  }
  const t = String(field).trim().replace(/,/g, '');
  if (/^\d+$/u.test(t)) return BigInt(t);
  const dot = t.indexOf('.');
  if (dot > 0 && /^\d+$/.test(t.slice(0, dot))) return BigInt(t.slice(0, dot));
  return BigInt(t);
}

function parseBridgeOperatorOption(opField: unknown): string | null {
  const o = opField as { alternative?: number; constructor?: number; fields?: unknown[] };
  const tag = o.alternative ?? o.constructor;
  const inner = o.fields ?? [];
  if (tag === 1 && inner.length === 0) return null;
  if (tag === 0 && inner.length === 1) return readHexBytesField(inner[0]);
  throw new Error('Unexpected bridge_operator option in LockDatum');
}

export function parseLockDatumFromMeshData(d: Data): LockDatumParams {
  const root = d as unknown as { fields?: Data[] };
  const f = root.fields;
  if (!Array.isArray(f) || f.length < 10) {
    throw new Error('Unexpected LockDatum shape from chain');
  }
  const bridgeOperatorVkeyHashHex56 = parseBridgeOperatorOption(f[9]);
  return {
    depositorVkeyHashHex56: readHexBytesField(f[0]),
    recipientVkeyHashHex56: readHexBytesField(f[1]),
    policyIdHex: readHexBytesField(f[2]),
    assetNameHex: readHexBytesField(f[3]),
    amount: readBigIntField(f[4]),
    lockNonce: readBigIntField(f[5]),
    recipientCommitmentHex: readHexBytesField(f[6]),
    sourceChainId: readBigIntField(f[7]),
    destinationChainId: readBigIntField(f[8]),
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
