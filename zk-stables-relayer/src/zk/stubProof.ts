import { createHash } from 'node:crypto';
import { intentAmountToTokenUnits } from '../adapters/amount.js';
import type { BridgeIntent } from '../types.js';
import {
  computeCardanoLockEventCommitmentDigest,
  computeDepositCommitmentDigest,
  computeMidnightBurnEventCommitmentDigest,
  parseLockNonceDecimal,
} from './cardanoEncoding.js';

function zkChainIdFromEnv(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  return Number.parseInt(v, 10);
}

/** Architecture PDF: ZK circuit proves header finality + event inclusion. Until circuits ship, we bind intent to a deterministic digest. */
export function buildStubProofBundle(intent: BridgeIntent, lockRef: string): {
  algorithm: 'stub-sha256-v1' | 'midnight-compact-bridge-stub-v1';
  digest: string;
  publicInputsHex: string;
} {
  const record: Record<string, unknown> = {
    lockRef,
    operation: intent.operation,
    sourceChain: intent.sourceChain,
    assetKind: intent.assetKind,
    amount: intent.amount,
    recipient: intent.recipient,
  };
  if (intent.operation === 'BURN' && 'burnCommitmentHex' in intent) {
    record.burnCommitmentHex = intent.burnCommitmentHex;
  }

  const c = intent.source?.cardano;
  if (c?.txHash !== undefined && c.outputIndex !== undefined) {
    const lockNonce = parseLockNonceDecimal(c.lockNonce);
    try {
      const eventDigest = computeCardanoLockEventCommitmentDigest({
        policyIdHex: c.policyIdHex,
        assetNameHex: c.assetNameHex,
        txHashHex: c.txHash,
        outputIndex: c.outputIndex,
        lockNonce,
      });
      record.cardano = {
        ...c,
        eventCommitmentHex: eventDigest.toString('hex'),
      };
      const nonceCommitment = createHash('sha256').update(Buffer.from(lockRef, 'utf8')).digest();
      const opType = intent.operation === 'LOCK' ? 0 : 1;
      const evmBurnLog =
        intent.operation === 'BURN' &&
        intent.sourceChain === 'evm' &&
        Boolean(intent.source?.evm && typeof intent.source.evm.txHash === 'string');
      const amountRaw = intentAmountToTokenUnits(String(intent.amount), {
        operation: intent.operation,
        sourceChain: intent.sourceChain,
        evmBurnFromChainLog: evmBurnLog,
      });
      const depositDigest = computeDepositCommitmentDigest({
        operationType: opType,
        sourceChainId: zkChainIdFromEnv('RELAYER_ZK_SOURCE_CHAIN_ID', 0),
        destinationChainId: zkChainIdFromEnv('RELAYER_ZK_DEST_CHAIN_ID', 0),
        amountRaw,
        assetCode: intent.assetKind,
        lockNonce,
        nonceCommitment,
        eventCommitment: eventDigest,
      });
      record.depositCommitmentHex = depositDigest.toString('hex');
    } catch (e) {
      record.cardanoEventCommitmentError = e instanceof Error ? e.message : String(e);
    }
  }

  if (intent.operation === 'BURN') {
    const mid = intent.source?.midnight;
    if (mid && (mid.txId?.trim() || mid.txHash?.trim())) {
      const txIdRaw = (mid.txId?.trim() || mid.txHash?.trim()) as string;
      record.midnight = { ...mid, txId: txIdRaw };
      const bcBurn = intent.burnCommitmentHex.replace(/^0x/i, '').trim().toLowerCase();
      const destChainId =
        mid.destChainId !== undefined ? Number(mid.destChainId) : zkChainIdFromEnv('RELAYER_ZK_DEST_CHAIN_ID', 0);
      if (bcBurn.length === 64 && /^[0-9a-f]+$/u.test(bcBurn)) {
        try {
          const eventDigest = computeMidnightBurnEventCommitmentDigest({
            destChainId,
            recipientCommHex: bcBurn,
            midnightTxIdHex: txIdRaw,
          });
          record.midnight = { ...mid, txId: txIdRaw, eventCommitmentHex: eventDigest.toString('hex') };
        } catch (e) {
          record.midnightEventCommitmentError = e instanceof Error ? e.message : String(e);
        }
      }
    }
  }

  const payload = JSON.stringify(record);
  const digest = createHash('sha256').update(payload).digest('hex');
  const publicInputsHex = createHash('sha256').update(`${digest}:public`).digest('hex');
  const algorithm =
    intent.sourceChain === 'midnight' ? 'midnight-compact-bridge-stub-v1' : 'stub-sha256-v1';
  return {
    algorithm,
    digest,
    publicInputsHex,
  };
}
