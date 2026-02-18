import { getLockPoolScript } from '../scripts.js';
import { buildLockDatum, redeemerUserRefund } from '../plutusData.js';
import type { BridgeContext } from '../context.js';
import { getTxBuilder } from '../context.js';
import { fetchUtxo } from '../utxo.js';
import type { LockSpendParams } from '../params.js';

/** Depositor refunds the locked UTxO (`UserRefund` + depositor must sign). */
export async function submitRefund(ctx: BridgeContext, p: LockSpendParams): Promise<{ txHash: string }> {
  const { scriptCbor } = getLockPoolScript(ctx.blueprint, ctx.networkId);
  const datum = buildLockDatum(p);
  const signerHash = p.depositorVkeyHashHex56;

  const scriptUtxo = await fetchUtxo(ctx.fetcher, p.lockTxHash, p.lockOutputIndex);
  const utxos = await ctx.wallet.getUtxos();
  const change = ctx.wallet.getChangeAddress();
  const walletUsed = (await ctx.wallet.getUsedAddresses())[0] ?? change;

  const collateralList = await ctx.wallet.getCollateral();
  const collateral = collateralList[0];
  if (!collateral) throw new Error('No collateral UTxO for Plutus spend');

  const refundAddress = process.env.LOCK_REFUND_TO_ADDRESS ?? walletUsed;

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
    .txInRedeemerValue(redeemerUserRefund)
    .txInDatumValue(datum)
    .requiredSignerHash(signerHash)
    .txOut(refundAddress, scriptUtxo.output.amount)
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
