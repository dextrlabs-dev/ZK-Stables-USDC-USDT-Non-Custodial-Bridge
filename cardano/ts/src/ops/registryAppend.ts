import { getUnlockPoolScript } from '../scripts.js';
import { buildRegistryDatum, buildRegistryRedeemer } from '../plutusData.js';
import type { BridgeContext } from '../context.js';
import { getTxBuilder } from '../context.js';
import { fetchUtxo } from '../utxo.js';
import { parseUsedNoncesFromDatumCbor } from '../registryDatum.js';

/**
 * Append a nonce to the registry (operator must sign). Continuing output keeps full `scriptUtxo` value.
 */
export async function submitRegistryAppend(
  ctx: BridgeContext,
  operatorVkeyHash28Hex: string,
  registryTxHash: string,
  registryOutputIndex: number,
  nonceHex: string,
): Promise<{ txHash: string }> {
  const { scriptCbor, address: scriptAddr } = getUnlockPoolScript(
    ctx.blueprint,
    operatorVkeyHash28Hex,
    ctx.networkId,
  );

  const scriptUtxo = await fetchUtxo(ctx.fetcher, registryTxHash, registryOutputIndex);
  const pd = scriptUtxo.output.plutusData;
  if (!pd) throw new Error('Registry UTxO must carry inline datum (plutusData)');

  const prev = parseUsedNoncesFromDatumCbor(pd);
  if (prev.includes(nonceHex)) throw new Error('Nonce already recorded');
  const nextDatum = buildRegistryDatum([...prev, nonceHex]);
  const redeemer = buildRegistryRedeemer(nonceHex);

  const utxos = await ctx.wallet.getUtxos();
  const change = ctx.wallet.getChangeAddress();
  const walletUsed = (await ctx.wallet.getUsedAddresses())[0] ?? change;

  const collateralList = await ctx.wallet.getCollateral();
  const collateral = collateralList[0];
  if (!collateral) throw new Error('No collateral UTxO for Plutus spend');

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
    .txInRedeemerValue(redeemer)
    .txInInlineDatumPresent()
    .requiredSignerHash(operatorVkeyHash28Hex)
    .txOut(scriptAddr, scriptUtxo.output.amount)
    .txOutInlineDatumValue(nextDatum)
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

  const signed = await ctx.wallet.signTx(txBuilder.txHex);
  const txHash = await ctx.wallet.submitTx(signed);
  return { txHash };
}
