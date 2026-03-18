/**
 * EVM burn `event_commitment` + outer `depositCommitment` for BURN_UNLOCK (see contract/docs/DEPOSIT_COMMITMENT_ENCODING.md).
 */
import { createHash } from 'node:crypto';
import type { BridgeIntent, BurnIntent } from '../types.js';
import {
  computeCardanoBurnEventCommitmentDigest,
  computeDepositCommitmentDigest,
  computeMidnightBurnEventCommitmentDigest,
  parseLockNonceDecimal,
  type DepositCommitmentParams,
} from './cardanoEncoding.js';

const EVM_BURN_DOMAIN = Buffer.from('ZKStables:EVM:Burn:v1', 'utf8');

function hexToBytes32(hex: string): Buffer {
  const h = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (h.length !== 64) throw new Error('expected 32-byte hex (64 chars)');
  return Buffer.from(h, 'hex');
}

function evmAddrTo20(hex: string): Buffer {
  const h = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (h.length !== 40) throw new Error('expected 20-byte EVM address (40 hex chars)');
  return Buffer.from(h, 'hex');
}

function u32be(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0, 0);
  return b;
}

function u256be(n: bigint): Buffer {
  const b = Buffer.alloc(32, 0);
  let x = n;
  for (let i = 31; i >= 0 && x > 0n; i--) {
    b[i] = Number(x & 0xffn);
    x >>= 8n;
  }
  if (x > 0n) throw new Error('amount does not fit uint256_be');
  return b;
}

/** First 8 bytes of burn `bytes32` nonce as uint64_be for deposit commitment `lock_nonce` field (bridge-local convention). */
export function burnNonceHexToLockNonceU64(nonceHex: string): bigint {
  const b = hexToBytes32(nonceHex);
  return b.readBigUInt64BE(24);
}

export type EvmBurnEventParams = {
  evmChainId: number;
  wrappedTokenAddress: string;
  fromAddress: string;
  recipientOnSource: string;
  amount: bigint;
  /** 32-byte burn nonce from Burned log */
  nonceHex: string;
  /** User-supplied 32-byte burn binding (Midnight ticket / deposit anchor) */
  burnCommitmentHex: string;
};

export function computeEvmBurnEventCommitmentDigest(params: EvmBurnEventParams): Buffer {
  const nonce = hexToBytes32(params.nonceHex);
  const burnCommitment = hexToBytes32(params.burnCommitmentHex);
  const preimage = Buffer.concat([
    EVM_BURN_DOMAIN,
    u32be(params.evmChainId),
    evmAddrTo20(params.wrappedTokenAddress),
    evmAddrTo20(params.fromAddress),
    evmAddrTo20(params.recipientOnSource),
    u256be(params.amount),
    nonce,
    burnCommitment,
  ]);
  return createHash('sha256').update(preimage).digest();
}

export function computeBurnUnlockDepositCommitment(params: {
  deposit: Omit<DepositCommitmentParams, 'eventCommitment' | 'operationType'>;
  evmBurn: EvmBurnEventParams;
}): Buffer {
  const eventCommitment = computeEvmBurnEventCommitmentDigest(params.evmBurn);
  return computeDepositCommitmentDigest({
    ...params.deposit,
    operationType: 1,
    eventCommitment,
  });
}

function zkChainIdFromEnv(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  return Number.parseInt(v, 10);
}

/**
 * Full `depositCommitment` hex for relayer jobs (Midnight-facing), when BURN + `burnCommitmentHex` + source fields are present.
 */
export function computeBurnDepositCommitmentHexFromIntent(intent: BridgeIntent, lockRef: string): string | undefined {
  if (intent.operation !== 'BURN') return undefined;
  const bi = intent as BurnIntent;
  const bc = bi.burnCommitmentHex?.replace(/^0x/i, '') ?? '';
  if (bc.length !== 64) return undefined;

  const nonceCommitment = createHash('sha256').update(Buffer.from(lockRef, 'utf8')).digest();
  const zkSrc = zkChainIdFromEnv('RELAYER_ZK_SOURCE_CHAIN_ID', 0);
  const zkDest = zkChainIdFromEnv('RELAYER_ZK_DEST_CHAIN_ID', 0);
  const amountRaw = BigInt(intent.amount);
  const assetCode = intent.assetKind;

  if (intent.sourceChain === 'evm' && intent.source?.evm?.wrappedTokenAddress && intent.source.evm.fromAddress && intent.source.evm.nonce) {
    const ev = intent.source.evm;
    const nonceHex = ev.nonce!.startsWith('0x') ? ev.nonce! : (`0x${ev.nonce!}` as const);
    const lockNonce = burnNonceHexToLockNonceU64(nonceHex);
    const evmChainId = zkChainIdFromEnv('RELAYER_ZK_EVM_CHAIN_ID', zkChainIdFromEnv('RELAYER_EVM_CHAIN_ID', 31337));
    const digest = computeBurnUnlockDepositCommitment({
      deposit: {
        sourceChainId: zkSrc,
        destinationChainId: zkDest,
        amountRaw,
        assetCode,
        lockNonce,
        nonceCommitment,
      },
      evmBurn: {
        evmChainId,
        wrappedTokenAddress: ev.wrappedTokenAddress!,
        fromAddress: ev.fromAddress!,
        recipientOnSource: intent.recipient,
        amount: amountRaw,
        nonceHex,
        burnCommitmentHex: `0x${bc}`,
      },
    });
    return digest.toString('hex');
  }

  if (
    intent.sourceChain === 'cardano' &&
    intent.source?.cardano?.txHash !== undefined &&
    intent.source.cardano.outputIndex !== undefined
  ) {
    const c = intent.source.cardano;
    const lockNonce = parseLockNonceDecimal(c.lockNonce);
    const eventCommitment = computeCardanoBurnEventCommitmentDigest({
      txHashHex: c.txHash,
      outputIndex: c.outputIndex,
      burnCommitmentHex: bc,
    });
    const digest = computeDepositCommitmentDigest({
      operationType: 1,
      sourceChainId: zkSrc,
      destinationChainId: zkDest,
      amountRaw,
      assetCode,
      lockNonce,
      nonceCommitment,
      eventCommitment,
    });
    return digest.toString('hex');
  }

  if (intent.sourceChain === 'midnight') {
    const mid = intent.source?.midnight;
    const txIdRaw = mid?.txId?.trim() || mid?.txHash?.trim();
    if (!txIdRaw) return undefined;
    const destChainId =
      mid?.destChainId !== undefined
        ? Number(mid.destChainId)
        : zkChainIdFromEnv('RELAYER_ZK_DEST_CHAIN_ID', zkDest);
    const lockNonce = parseLockNonceDecimal(mid?.lockNonce);
    const eventCommitment = computeMidnightBurnEventCommitmentDigest({
      destChainId,
      recipientCommHex: bc,
      midnightTxIdHex: txIdRaw,
    });
    const digest = computeDepositCommitmentDigest({
      operationType: 1,
      sourceChainId: zkSrc,
      destinationChainId: zkDest,
      amountRaw,
      assetCode,
      lockNonce,
      nonceCommitment,
      eventCommitment,
    });
    return digest.toString('hex');
  }

  return undefined;
}
