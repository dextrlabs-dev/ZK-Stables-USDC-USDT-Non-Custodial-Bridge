import type { UTxO } from '@meshsdk/common';
import { deserializeAddress } from '@meshsdk/core';
import { createDefaultContext } from '../context.js';
import type { BridgeContext } from '../context.js';
import { submitLock } from '../ops/lock.js';
import { submitRefund } from '../ops/refund.js';
import { submitRegistryAppend } from '../ops/registryAppend.js';
import { submitRegistryInit } from '../ops/registryInit.js';
import { buildLockDatumParamsFromEnv } from './common.js';
import { getUnlockPoolScript } from '../scripts.js';

/** Yaci Store lags the node briefly after submit; Blockfrost is usually ready. */
async function waitForIndexerUtxos(ctx: BridgeContext, txHash: string): Promise<UTxO[]> {
  const delayMs = 400;
  const maxAttempts = 40;
  let lastErr: unknown;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const outs = await ctx.fetcher.fetchUTxOs(txHash);
      if (outs.length > 0) return outs;
    } catch (e) {
      lastErr = e;
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  throw lastErr ?? new Error(`Indexer did not return UTxOs for ${txHash}`);
}

/**
 * MeshWallet uses `fetchAddressUTxOs` for coin selection. That endpoint can briefly still list
 * inputs already spent by a just-submitted tx, which yields BadInputs on the follow-up tx.
 */
async function waitForAddressIndexerShowsTxOutputs(
  ctx: BridgeContext,
  address: string,
  txHash: string,
): Promise<void> {
  const delayMs = 400;
  const maxAttempts = 50;
  for (let i = 0; i < maxAttempts; i++) {
    const utxos = await ctx.fetcher.fetchAddressUTxOs(address);
    if (utxos.some((u) => u.input.txHash === txHash)) return;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new Error(`Indexer did not list any UTxO at ${address} from tx ${txHash}`);
}

async function main() {
  const ctx = createDefaultContext();

  // 1) Lock
  const datum = await buildLockDatumParamsFromEnv(ctx);
  const { txHash: lockTx, scriptAddress: lockScriptAddr } = await submitLock(ctx, {
    ...datum,
    assets: [{ unit: 'lovelace', quantity: '2000000' }],
  });

  // find actual script output index
  const outs = await waitForIndexerUtxos(ctx, lockTx);
  const lockUtxo = outs.find((u) => u.output.address === lockScriptAddr);
  if (!lockUtxo) throw new Error('Lock output not found (address mismatch)');

  const changeAddr = ctx.wallet.getChangeAddress();
  await waitForAddressIndexerShowsTxOutputs(ctx, changeAddr, lockTx);

  // 2) Refund spend
  const refundTx = await submitRefund(ctx, {
    ...datum,
    lockTxHash: lockTx,
    lockOutputIndex: lockUtxo.input.outputIndex,
  });

  await waitForAddressIndexerShowsTxOutputs(ctx, changeAddr, refundTx.txHash);

  // 3) Registry init + append
  const used = await ctx.wallet.getUsedAddresses();
  const payAddr = used[0] ?? ctx.wallet.getChangeAddress();
  const { pubKeyHash } = deserializeAddress(payAddr);

  const { txHash: regTx } = await submitRegistryInit(ctx, pubKeyHash, '3000000');
  await waitForAddressIndexerShowsTxOutputs(ctx, changeAddr, regTx);
  const regOuts = await waitForIndexerUtxos(ctx, regTx);
  const unlockAddr = getUnlockPoolScript(ctx.blueprint, pubKeyHash, ctx.networkId).address;
  const regUtxo = regOuts.find((u) => u.output.address === unlockAddr);
  if (!regUtxo) throw new Error('Registry output not found');

  const nonceHex = Buffer.from(`nonce-${Date.now()}`, 'utf8').toString('hex');
  const appendTx = await submitRegistryAppend(
    ctx,
    pubKeyHash,
    regTx,
    regUtxo.input.outputIndex,
    nonceHex,
  );

  console.log(
    JSON.stringify(
      {
        lockTx,
        lockScriptAddr,
        lockOutputIndex: lockUtxo.input.outputIndex,
        refundTx: refundTx.txHash,
        registryInitTx: regTx,
        registryOutputIndex: regUtxo.input.outputIndex,
        registryAppendTx: appendTx.txHash,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

