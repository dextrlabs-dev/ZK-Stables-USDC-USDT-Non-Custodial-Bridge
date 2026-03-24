/**
 * Parse Aiken `LockDatum` from Mesh `deserializeDatum` result (`alternative` + `fields`).
 * Must match `cardano/aiken/lib/zk_stables_bridge/types.ak` and `plutusData.buildLockDatum`.
 */
import type { Data } from '@meshsdk/common';
import type { LockDatumParams } from './plutusData.js';

/** Plutus `Integer` from Mesh — never pass floats to `BigInt()` (throws). */
function meshPlutusIntegerToBigInt(field: unknown, label: string): bigint {
  if (field === undefined || field === null) throw new Error(`LockDatum ${label} missing`);
  if (typeof field === 'bigint') return field;
  if (typeof field === 'number') {
    if (!Number.isFinite(field)) throw new Error(`LockDatum ${label} not finite`);
    return BigInt(Math.trunc(field));
  }
  if (field && typeof field === 'object' && 'int' in field) {
    return meshPlutusIntegerToBigInt((field as { int: unknown }).int, label);
  }
  const t = String(field).trim().replace(/,/g, '');
  if (/^\d+$/u.test(t)) return BigInt(t);
  const dot = t.indexOf('.');
  if (dot > 0 && /^\d+$/.test(t.slice(0, dot))) return BigInt(t.slice(0, dot));
  return BigInt(t);
}

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
    amount: meshPlutusIntegerToBigInt(f[4], 'amount'),
    lockNonce: meshPlutusIntegerToBigInt(f[5], 'lockNonce'),
    recipientCommitmentHex: String(f[6]),
    sourceChainId: meshPlutusIntegerToBigInt(f[7], 'sourceChainId'),
    destinationChainId: meshPlutusIntegerToBigInt(f[8], 'destinationChainId'),
    bridgeOperatorVkeyHashHex56,
  };
}

/** Normalize 32-byte commitment hex for comparison (no 0x, lowercase). */
export function normalizeBurnCommitmentHex64(hex: string): string {
  const h = hex.replace(/^0x/i, '').trim().toLowerCase();
  if (h.length !== 64 || !/^[0-9a-f]+$/u.test(h)) {
    throw new Error('burnCommitmentHex must be 64 hex chars');
  }
  return h;
}

export function normalizeDatumRecipientCommitment(hex: string): string {
  let h = hex.replace(/^0x/i, '').trim().toLowerCase();
  if (h.length > 64) h = h.slice(0, 64);
  if (h.length !== 64 || !/^[0-9a-f]+$/u.test(h)) {
    throw new Error('datum recipient_commitment must be 64 hex chars');
  }
  return h;
}
