import { getUnlockPoolScript } from '../scripts.js';
import { buildRegistryDatum } from '../plutusData.js';
import type { BridgeContext } from '../context.js';
import { getTxBuilder } from '../context.js';

/** Create an empty nonce registry UTxO at `unlock_pool` (inline datum). */
export async function submitRegistryInit(
  ctx: BridgeContext,
  operatorVkeyHash28Hex: string,
  lovelace: string,
): Promise<{ txHash: string; scriptAddress: string }> {
  const { address: scriptAddr } = getUnlockPoolScript(ctx.blueprint, operatorVkeyHash28Hex, ctx.networkId);
  const datum = buildRegistryDatum([]);
  const assets = [{ unit: 'lovelace', quantity: lovelace }];

  const utxos = await ctx.wallet.getUtxos();
  const change = ctx.wallet.getChangeAddress();
  const walletUsed = (await ctx.wallet.getUsedAddresses())[0] ?? change;

  const txBuilder = getTxBuilder(ctx);
  await txBuilder
    .txOut(scriptAddr, assets)
    .txOutInlineDatumValue(datum)
    .changeAddress(walletUsed)
    .selectUtxosFrom(utxos)
    .setNetwork(ctx.meshNetwork)
    .complete();

  const signed = await ctx.wallet.signTx(txBuilder.txHex);
  const txHash = await ctx.wallet.submitTx(signed);
  return { txHash, scriptAddress: scriptAddr };
}
