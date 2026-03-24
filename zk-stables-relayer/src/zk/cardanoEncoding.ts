/**
 * Canonical byte layout for Cardano lock `event_commitment` and outer `depositCommitment`
 * per contract/docs/DEPOSIT_COMMITMENT_ENCODING.md (SHA-256, big-endian integers).
 */

import { createHash } from 'node:crypto';

const CARDANO_LOCK_DOMAIN = Buffer.from('ZKStables:Cardano:Lock:v1', 'utf8');
const CARDANO_BURN_DOMAIN = Buffer.from('ZKStables:Cardano:Burn:v1', 'utf8');
const MIDNIGHT_BURN_DOMAIN = Buffer.from('ZKStables:Midnight:Burn:v1', 'utf8');
const DEPOSIT_DOMAIN = Buffer.from('ZKStables:Deposit:v1', 'utf8');

function hexToBytes(hex: string): Buffer {
  const h = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (h.length % 2 !== 0) throw new Error('hex length must be even');
  return Buffer.from(h, 'hex');
}

/** 28-byte mint policy left-aligned in 32 bytes (remaining bytes zero). */
export function padPolicyIdToBytes32(policyIdHex?: string): Buffer {
  const out = Buffer.alloc(32, 0);
  if (!policyIdHex) return out;
  const raw = hexToBytes(policyIdHex);
  if (raw.length > 28) {
    throw new Error(`Cardano policy id must be at most 28 bytes, got ${raw.length}`);
  }
  raw.copy(out, 0);
  return out;
}

/** Asset name truncated/padded on the right to 32 bytes. */
export function padAssetNameToBytes32(assetNameHex?: string): Buffer {
  const out = Buffer.alloc(32, 0);
  if (!assetNameHex) return out;
  const raw = hexToBytes(assetNameHex);
  raw.copy(out, 0, 0, Math.min(32, raw.length));
  return out;
}

export function txHashToBytes32(txHashHex: string): Buffer {
  const raw = hexToBytes(txHashHex);
  if (raw.length !== 32) {
    throw new Error(`Cardano tx id must be 32 bytes (64 hex chars), got ${raw.length}`);
  }
  return raw;
}

function u32be(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0, 0);
  return b;
}

function u64be(n: bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64BE(n, 0);
  return b;
}

function u256be(n: bigint): Buffer {
  const b = Buffer.alloc(32, 0);
  let x = n;
  for (let i = 31; i >= 0 && x > 0n; i--) {
    b[i] = Number(x & 0xffn);
    x >>= 8n;
  }
  if (x > 0n) throw new Error('amount_raw does not fit uint256_be');
  return b;
}

export type CardanoLockEventParams = {
  policyIdHex?: string;
  assetNameHex?: string;
  txHashHex: string;
  outputIndex: number;
  lockNonce: bigint;
};

/** Inner hash for Cardano lock UTxO observation. */
/** Synthetic burn observation for Cardano (test / manual POST) — binds UTxO ref + `burnCommitment`. */
export function computeCardanoBurnEventCommitmentDigest(params: {
  txHashHex: string;
  outputIndex: number;
  burnCommitmentHex: string;
}): Buffer {
  const bc = hexToBytes(params.burnCommitmentHex.startsWith('0x') ? params.burnCommitmentHex.slice(2) : params.burnCommitmentHex);
  if (bc.length !== 32) throw new Error('burnCommitment must be 32 bytes');
  const preimage = Buffer.concat([
    CARDANO_BURN_DOMAIN,
    txHashToBytes32(params.txHashHex),
    u32be(params.outputIndex),
    bc,
  ]);
  return createHash('sha256').update(preimage).digest();
}

/**
 * Inner `event_commitment` for Midnight `initiateBurn` (holder sets `recipientCommitment` = `burnCommitmentHex`).
 * Binds destination chain id, the 32-byte recipient commitment, and the Midnight transaction id bytes.
 */
export function computeMidnightBurnEventCommitmentDigest(params: {
  destChainId: number;
  recipientCommHex: string;
  midnightTxIdHex: string;
}): Buffer {
  const h = params.recipientCommHex.replace(/^0x/i, '').trim().toLowerCase();
  if (h.length !== 64 || !/^[0-9a-f]+$/u.test(h)) {
    throw new Error('recipientCommHex must be 64 hex chars');
  }
  const bc = hexToBytes(h);
  let txRaw = hexToBytes(params.midnightTxIdHex.replace(/^0x/i, '').trim());
  if (txRaw.length > 32) txRaw = txRaw.subarray(txRaw.length - 32);
  if (txRaw.length < 32) {
    const pad = Buffer.alloc(32 - txRaw.length, 0);
    txRaw = Buffer.concat([pad, txRaw]);
  }
  const preimage = Buffer.concat([MIDNIGHT_BURN_DOMAIN, u32be(params.destChainId >>> 0), bc, txRaw]);
  return createHash('sha256').update(preimage).digest();
}

export function computeCardanoLockEventCommitmentDigest(
  params: CardanoLockEventParams,
): Buffer {
  const preimage = Buffer.concat([
    CARDANO_LOCK_DOMAIN,
    padPolicyIdToBytes32(params.policyIdHex),
    padAssetNameToBytes32(params.assetNameHex),
    txHashToBytes32(params.txHashHex),
    u32be(params.outputIndex),
    u64be(params.lockNonce),
  ]);
  return createHash('sha256').update(preimage).digest();
}

export type DepositCommitmentParams = {
  operationType: number;
  sourceChainId: number;
  destinationChainId: number;
  amountRaw: bigint;
  assetCode: number;
  lockNonce: bigint;
  /** 32 bytes */
  nonceCommitment: Buffer;
  /** 32 bytes — typically `computeCardanoLockEventCommitmentDigest`. */
  eventCommitment: Buffer;
};

/** Global Midnight-facing commitment per DEPOSIT_COMMIT preimage. */
export function computeDepositCommitmentDigest(params: DepositCommitmentParams): Buffer {
  if (params.nonceCommitment.length !== 32 || params.eventCommitment.length !== 32) {
    throw new Error('nonceCommitment and eventCommitment must be 32 bytes');
  }
  const ac = params.assetCode & 0xff;
  const preimage = Buffer.concat([
    DEPOSIT_DOMAIN,
    u32be(params.operationType),
    u32be(params.sourceChainId),
    u32be(params.destinationChainId),
    u256be(params.amountRaw),
    Buffer.from([ac]),
    u64be(params.lockNonce),
    params.nonceCommitment,
    params.eventCommitment,
  ]);
  return createHash('sha256').update(preimage).digest();
}

/**
 * Lock nonce is a UInt64 on-chain; the relayer accepts it from JSON as string or number.
 * `BigInt(11948.7)` and `BigInt("11948.7")` throw in JS — normalize first (integer prefix for stray floats).
 */
export function parseLockNonceDecimal(input?: unknown): bigint {
  if (input === undefined || input === null || input === '') return 0n;
  if (typeof input === 'bigint') return input;
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) return 0n;
    return BigInt(Math.trunc(input));
  }
  const t = String(input).trim().replace(/,/g, '');
  if (!t) return 0n;
  if (/^\d+$/u.test(t)) return BigInt(t);
  const dot = t.indexOf('.');
  if (dot > 0 && /^\d+$/.test(t.slice(0, dot))) return BigInt(t.slice(0, dot));
  return 0n;
}
