import { deserializeAddress } from '@meshsdk/core';
import type { LockDatumParams } from '../plutusData.js';
import type { BridgeContext } from '../context.js';

function envBigInt(name: string, def: string): bigint {
  return BigInt(process.env[name] ?? def);
}

export async function defaultKeyHashesFromWallet(ctx: BridgeContext): Promise<{
  depositor: string;
  recipient: string;
}> {
  const used = await ctx.wallet.getUsedAddresses();
  const addr = used[0];
  if (!addr) throw new Error('Wallet has no used address');
  const { pubKeyHash } = deserializeAddress(addr);
  return { depositor: pubKeyHash, recipient: pubKeyHash };
}

export async function buildLockDatumParamsFromEnv(ctx: BridgeContext): Promise<LockDatumParams> {
  const { depositor, recipient } = await defaultKeyHashesFromWallet(ctx);
  const opRaw = process.env.BRIDGE_OPERATOR_VKEY_HASH?.trim();
  return {
    depositorVkeyHashHex56: process.env.LOCK_DEPOSITOR_VKEY_HASH ?? depositor,
    recipientVkeyHashHex56: process.env.LOCK_RECIPIENT_VKEY_HASH ?? recipient,
    policyIdHex: process.env.LOCK_POLICY_ID_HEX ?? '',
    assetNameHex: process.env.LOCK_ASSET_NAME_HEX ?? '',
    amount: envBigInt('LOCK_DATUM_AMOUNT', process.env.LOCK_LOVELACE ?? '1000000'),
    lockNonce: envBigInt('LOCK_NONCE', '0'),
    recipientCommitmentHex: process.env.LOCK_RECIPIENT_COMMITMENT_HEX ?? '',
    sourceChainId: envBigInt('LOCK_SOURCE_CHAIN_ID', '0'),
    destinationChainId: envBigInt('LOCK_DEST_CHAIN_ID', '0'),
    bridgeOperatorVkeyHashHex56: opRaw && opRaw.length > 0 ? opRaw : null,
  };
}

export function parseTxRef(ref: string): { txHash: string; ix: number } {
  const [txHash, i] = ref.split('#');
  if (!txHash || i === undefined) throw new Error(`Bad tx ref ${ref}, expected txHash#ix`);
  return { txHash, ix: Number(i) };
}
