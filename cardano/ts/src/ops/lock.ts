import type { Asset } from '@meshsdk/common';
import { deserializeDatum } from '@meshsdk/core';
import { getLockPoolScript } from '../scripts.js';
import { buildLockDatum } from '../plutusData.js';
import type { LockDatumParams } from '../plutusData.js';
import type { BridgeContext } from '../context.js';
import { getTxBuilder } from '../context.js';

export type LockParams = LockDatumParams & {
  /** Assets locked at the script (min 1 lovelace + optional tokens). */
  assets: Asset[];
};

/**
 * Send `assets` to the lock pool script with datum hash (same as hello_world Mesh flow).
 */
export async function submitLock(ctx: BridgeContext, p: LockParams): Promise<{ txHash: string; scriptAddress: string }> {
  const { scriptCbor, address: scriptAddr } = getLockPoolScript(ctx.blueprint, ctx.networkId);
  const datum = buildLockDatum(p);

  const utxos = await ctx.wallet.getUtxos();
  const change = ctx.wallet.getChangeAddress();
  const walletUsed = (await ctx.wallet.getUsedAddresses())[0] ?? change;

  const txBuilder = getTxBuilder(ctx);
  txBuilder
    .txOut(scriptAddr, p.assets)
    .txOutDatumHashValue(datum)
    .changeAddress(walletUsed)
    .selectUtxosFrom(utxos)
    .setNetwork(ctx.meshNetwork);

  await txBuilder.complete();
  const unsigned = txBuilder.txHex;
  const signed = await ctx.wallet.signTx(unsigned);
  const txHash = await ctx.wallet.submitTx(signed);
  return { txHash, scriptAddress: scriptAddr };
}

/** Helper: decode inline / hash datum CBOR from a lock UTxO (when present). */
export function tryDecodeLockDatumUtxo(utxo: { output: { plutusData?: string } }): unknown | null {
  const raw = utxo.output.plutusData;
  if (!raw) return null;
  try {
    return deserializeDatum(raw);
  } catch {
    return null;
  }
}
