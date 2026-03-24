import { MeshTxBuilder, deserializeAddress, deserializeDatum } from '@meshsdk/core';
import type { Data, IEvaluator, IFetcher, UTxO } from '@meshsdk/common';
import { mConStr1 } from '@meshsdk/common';
import { fetchCardanoBridgeMetadata } from './bridgeMetadata.js';
import { parseLockDatumFromMeshData, normalizeDatumRecipientCommitment } from './lockDatumParse.js';
import { createBrowserCardanoIndexer, type CardanoIndexer } from './meshCardanoIndexer.js';
import { findWalletBech32ForPaymentKeyHash } from './walletPaymentAddresses.js';
import { resolveBridgeSigningWallet } from './resolveBridgeSigningWallet.js';
import { fetchUTxOsWithRetry } from './fetchUTxOsWithRetry.js';

const redeemerBridgeRelease: Data = mConStr1([]);

export type { CardanoBridgeMetadata } from './bridgeMetadata.js';
export { fetchCardanoBridgeMetadata } from './bridgeMetadata.js';

async function fetchLockUtxo(fetcher: IFetcher, txHash: string, outputIndex: number): Promise<UTxO> {
  const utxos = await fetchUTxOsWithRetry(
    fetcher,
    txHash,
    outputIndex,
    `BridgeRelease (lock ${txHash.replace(/^0x/i, '').trim().toLowerCase()}#${outputIndex})`,
  );
  const u = utxos.find((x) => x.input.outputIndex === outputIndex) ?? utxos[0];
  if (!u) throw new Error(`No UTxO for ${txHash}#${outputIndex}`);
  return u;
}

/**
 * User-signed `BridgeRelease` for a lock UTxO whose datum has **no** bridge operator (recipient-only).
 * @see `RELAYER_CARDANO_DESTINATION_LOCK_HOLD` mint path on the relayer.
 */
export async function userWalletBridgeReleaseLockUtxo(opts: {
  cip30WalletKey: string;
  useDemoMnemonicWallet?: boolean;
  relayerBaseUrl: string;
  lockTxHash: string;
  lockOutputIndex: number;
  /** Defaults to first used address from the wallet. */
  payoutBech32?: string;
}): Promise<{ releaseTxHash: string; recipientCommitmentHex64: string; lockNonceDecimal: string }> {
  const meta = await fetchCardanoBridgeMetadata(opts.relayerBaseUrl);
  let fetcher: CardanoIndexer;
  try {
    fetcher = createBrowserCardanoIndexer();
  } catch (e) {
    throw new Error(
      `${e instanceof Error ? e.message : String(e)} Relayer health may show Cardano, but the browser needs VITE_YACI_URL or VITE_BLOCKFROST_PROJECT_ID.`,
    );
  }

  const wallet = await resolveBridgeSigningWallet({
    cip30WalletKey: opts.cip30WalletKey,
    useDemoMnemonicWallet: Boolean(opts.useDemoMnemonicWallet),
  });

  const scriptUtxo = await fetchLockUtxo(fetcher, opts.lockTxHash.trim(), opts.lockOutputIndex);
  const rawDatum = scriptUtxo.output.plutusData;
  if (!rawDatum) throw new Error('Lock UTxO has no inline Plutus datum');

  let datumData: Data;
  try {
    datumData = deserializeDatum(rawDatum) as Data;
  } catch (e) {
    throw new Error(`Failed to deserialize lock datum: ${e instanceof Error ? e.message : String(e)}`);
  }

  const params = parseLockDatumFromMeshData(datumData);
  if (params.bridgeOperatorVkeyHashHex56 !== null) {
    throw new Error(
      'This lock includes a bridge operator in the datum. User BridgeRelease only works for recipient-only locks (mint with RELAYER_CARDANO_DESTINATION_LOCK_HOLD on the relayer, or a matching policy).',
    );
  }

  const payout =
    opts.payoutBech32?.trim() ||
    (await findWalletBech32ForPaymentKeyHash(wallet, params.recipientVkeyHashHex56)) ||
    (await wallet.getUsedAddresses())[0]?.trim();
  if (!payout) throw new Error('Wallet returned no addresses; cannot choose payout.');

  const { pubKeyHash: payoutVkh } = deserializeAddress(payout);
  const wantVkh = params.recipientVkeyHashHex56.replace(/^0x/i, '').trim().toLowerCase();
  if (payoutVkh.replace(/^0x/i, '').trim().toLowerCase() !== wantVkh) {
    throw new Error(
      'Payout address does not match the lock datum recipient. Use the Cardano wallet whose payment key is the lock recipient (any used/unused address in that wallet).',
    );
  }

  const recipientCommitmentHex64 = normalizeDatumRecipientCommitment(params.recipientCommitmentHex);

  const utxos = await wallet.getUtxos();
  const change = (await wallet.getChangeAddress()).trim();
  if (!change) throw new Error('Wallet has no change address');

  const collateralList = await wallet.getCollateral();
  const collateral = collateralList[0];
  if (!collateral) throw new Error('No collateral UTxO — add collateral in your wallet for Plutus spends.');

  const txB = new MeshTxBuilder({
    fetcher,
    submitter: fetcher,
    evaluator: fetcher as unknown as IEvaluator,
  });

  await txB
    .spendingPlutusScript('V3')
    .txIn(
      scriptUtxo.input.txHash,
      scriptUtxo.input.outputIndex,
      scriptUtxo.output.amount,
      scriptUtxo.output.address,
    )
    .txInScript(meta.lockScriptCborHex)
    .txInRedeemerValue(redeemerBridgeRelease)
    .txInInlineDatumPresent()
    .requiredSignerHash(params.recipientVkeyHashHex56)
    .txOut(payout, scriptUtxo.output.amount)
    .changeAddress(change)
    .txInCollateral(
      collateral.input.txHash,
      collateral.input.outputIndex,
      collateral.output.amount,
      collateral.output.address,
    )
    .selectUtxosFrom(utxos)
    .setNetwork(meta.meshNetwork)
    .complete();

  const signed = await wallet.signTx(txB.txHex, true);
  const releaseTxHash = await wallet.submitTx(signed);
  if (!releaseTxHash) throw new Error('submitTx returned empty');

  return {
    releaseTxHash,
    recipientCommitmentHex64,
    lockNonceDecimal: params.lockNonce.toString(),
  };
}
