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

/** Mesh `deserializeDatum` uses `constructor` for nested Constr; `mConStr*` / older paths use `alternative`. */
function meshConstrIndex(v: unknown): number | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const o = v as { alternative?: number; constructor?: number };
  if (typeof o.alternative === 'number') return o.alternative;
  if (typeof o.constructor === 'number') return o.constructor;
  return undefined;
}

/** ByteArray / hash fields from `deserializeDatum` are often `{ bytes: "hexWithout0x" }`, not plain strings. */
export function meshPlutusBytesToHex(v: unknown): string {
  if (typeof v === 'string') {
    const t = v.trim().replace(/^0x/i, '');
    if (/^[0-9a-fA-F]+$/u.test(t)) return t.toLowerCase();
    throw new Error(`LockDatum bytes field is not hex: ${v.slice(0, 40)}${v.length > 40 ? '…' : ''}`);
  }
  if (v && typeof v === 'object' && 'bytes' in v) {
    const b = String((v as { bytes: string }).bytes).trim().replace(/^0x/i, '');
    if (!/^[0-9a-fA-F]+$/u.test(b)) throw new Error('LockDatum { bytes } is not hex');
    return b.toLowerCase();
  }
  throw new Error(`LockDatum expected Plutus bytes (string hex or { bytes }), got ${typeof v}`);
}

export function parseLockDatumFromMeshData(d: Data): LockDatumParams {
  const root = d as unknown as { alternative?: number; constructor?: number; fields: Data[] };
  const f = root.fields;
  if (!Array.isArray(f) || f.length < 10) {
    throw new Error('Unexpected LockDatum shape from chain');
  }
  const opField = f[9] as unknown as { alternative?: number; constructor?: number; fields?: Data[] };
  const opIx = meshConstrIndex(opField);
  const opFields = opField.fields ?? [];
  let bridgeOperatorVkeyHashHex56: string | null = null;
  if (opIx === 0 && opFields.length === 1) {
    bridgeOperatorVkeyHashHex56 = meshPlutusBytesToHex(opFields[0]);
  } else if (opIx === 1) {
    bridgeOperatorVkeyHashHex56 = null;
  } else {
    throw new Error('Unexpected bridge_operator option in LockDatum');
  }
  return {
    depositorVkeyHashHex56: meshPlutusBytesToHex(f[0]),
    recipientVkeyHashHex56: meshPlutusBytesToHex(f[1]),
    policyIdHex: meshPlutusBytesToHex(f[2]),
    assetNameHex: meshPlutusBytesToHex(f[3]),
    amount: meshPlutusIntegerToBigInt(f[4], 'amount'),
    lockNonce: meshPlutusIntegerToBigInt(f[5], 'lockNonce'),
    recipientCommitmentHex: meshPlutusBytesToHex(f[6]),
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
