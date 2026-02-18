import { getLockPoolScript } from '../scripts.js';
import { buildLockDatum, redeemerBridgeRelease } from '../plutusData.js';
import type { BridgeContext } from '../context.js';
import { getTxBuilder } from '../context.js';
import { fetchUtxo } from '../utxo.js';
import type { LockSpendParams } from '../params.js';

/**
 * Release path (`BridgeRelease`). Signer must be `recipient` if `bridge_operator` is None,
 * else the `bridge_operator` key hash.
 */
export async function submitRelease(ctx: BridgeContext, p: LockSpendParams): Promise<{ txHash: string }> {
  const { scriptCbor } = getLockPoolScript(ctx.blueprint, ctx.networkId);
  const datum = buildLockDatum(p);
  const signerHash =
    p.bridgeOperatorVkeyHashHex56 === null
      ? p.recipientVkeyHashHex56
      : p.bridgeOperatorVkeyHashHex56;

  const scriptUtxo = await fetchUtxo(ctx.fetcher, p.lockTxHash, p.lockOutputIndex);
  const utxos = await ctx.wallet.getUtxos();
  const change = ctx.wallet.getChangeAddress();
  const walletUsed = (await ctx.wallet.getUsedAddresses())[0] ?? change;

  const collateralList = await ctx.wallet.getCollateral();
  const collateral = collateralList[0];
  if (!collateral) throw new Error('No collateral UTxO for Plutus spend');

  const payoutAddress = process.env.LOCK_RELEASE_TO_ADDRESS ?? walletUsed;

  const txBuilder = getTxBuilder(ctx);
  await txBuilder
    .spendingPlutusScript('V3')
    .txIn(
      scriptUtxo.input.txHash,
      scriptUtxo.input.outputIndex,
      scriptUtxo.output.amount,
      scriptUtxo.output.address,
    )
    .txInScript(scriptCbor)
    .txInRedeemerValue(redeemerBridgeRelease)
    .txInDatumValue(datum)
    .requiredSignerHash(signerHash)
    .txOut(payoutAddress, scriptUtxo.output.amount)
    .changeAddress(walletUsed)
    .txInCollateral(
      collateral.input.txHash,
      collateral.input.outputIndex,
      collateral.output.amount,
      collateral.output.address,
    )
    .selectUtxosFrom(utxos)
    .setNetwork(ctx.meshNetwork)
    .complete();

  const unsigned = txBuilder.txHex;
  const signed = await ctx.wallet.signTx(unsigned);
  const txHash = await ctx.wallet.submitTx(signed);
  return { txHash };
}
