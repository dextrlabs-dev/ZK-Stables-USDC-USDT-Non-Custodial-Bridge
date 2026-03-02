/**
 * Aiken `lock_pool` validator (`cardano/aiken/validators/lock_pool.ak`): mint bridge tokens into the script,
 * then `BridgeRelease` to the user. Unlock from an existing lock UTxO uses the same redeemer.
 */
import {
  ForgeScript,
  MeshTxBuilder,
  deserializeAddress,
  deserializeDatum,
  resolveScriptHash,
  stringToHex,
} from '@meshsdk/core';
import type { Asset, Data, IEvaluator, IFetcher, ISubmitter, UTxO } from '@meshsdk/common';
import type { Logger } from 'pino';
import { parseDecimalAmountToUnits } from '../amount.js';
import { ensureCardanoBridgeWallet, cardanoRecipientMatchesNetwork } from '../cardanoPayout.js';
import { cardanoBridgeTokenName } from '../cardanoMintPayout.js';
import { loadBlueprint } from './blueprint.js';
import { buildLockDatum, redeemerBridgeRelease, type LockDatumParams } from './plutusData.js';
import { getLockPoolScript } from './scripts.js';
import { fetchUtxo } from './fetchUtxo.js';

export type LockSpendParams = LockDatumParams & {
  lockTxHash: string;
  lockOutputIndex: number;
};

function meshNetworkId(): 0 | 1 {
  return Number(process.env.RELAYER_CARDANO_NETWORK_ID ?? process.env.CARDANO_NETWORK_ID ?? 0) === 1 ? 1 : 0;
}

/** Mint WUSDC/WUSDT under ForgeScript, lock at `lock_pool` with inline datum, then release to recipient (2 txs). */
export async function lockMintThenBridgeRelease(params: {
  recipientBech32: string;
  amountStr: string;
  asset: 'USDC' | 'USDT';
  recipientCommitmentHex: string;
  logger: Logger;
}): Promise<{ lockTxHash: string; releaseTxHash: string; policyId: string; scriptAddress: string; detail: string }> {
  const ctx = await ensureCardanoBridgeWallet(params.logger);
  if (!ctx) throw new Error('Cardano bridge wallet not configured');

  const networkId = meshNetworkId();
  const rec = params.recipientBech32.trim();
  if (!cardanoRecipientMatchesNetwork(rec, networkId)) {
    throw new Error('Cardano recipient network mismatch');
  }

  const { wallet, fetcher, meshNetwork } = ctx;
  const change = wallet.getChangeAddress();
  if (!change?.trim()) throw new Error('MeshWallet has no change address');

  const { pubKeyHash: operatorVkh } = deserializeAddress(change);
  const { pubKeyHash: recipientVkh } = deserializeAddress(rec);

  const assetDecimals = Number(process.env.RELAYER_CARDANO_ASSET_DECIMALS ?? 6);
  const amountUnits = parseDecimalAmountToUnits(params.amountStr, assetDecimals);
  if (amountUnits <= 0n) throw new Error('Amount must be positive');

  const lovelaceOut = BigInt(process.env.RELAYER_CARDANO_PAYOUT_LOVELACE ?? '3000000');
  const minAda = BigInt(process.env.RELAYER_CARDANO_MINT_OUTPUT_LOVELACE ?? '2000000');
  const adaStr = (lovelaceOut > minAda ? lovelaceOut : minAda).toString();

  const tokenAscii = cardanoBridgeTokenName(params.asset);
  const forgingScript = ForgeScript.withOneSignature(change);
  const policyId = resolveScriptHash(forgingScript);
  const tokenNameHex = stringToHex(tokenAscii);
  const assetUnit = `${policyId}${tokenNameHex}`;
  const qtyStr = amountUnits.toString();

  const bp = loadBlueprint();
  const { scriptCbor, address: scriptAddr } = getLockPoolScript(bp, networkId);

  const sourceChainId = BigInt(process.env.RELAYER_CARDANO_LOCK_SOURCE_CHAIN_ID ?? '0');
  const destinationChainId = BigInt(process.env.RELAYER_CARDANO_LOCK_DEST_CHAIN_ID ?? '0');
  const lockNonce = BigInt(process.env.RELAYER_CARDANO_LOCK_NONCE ?? '0');

  const datum: LockDatumParams = {
    depositorVkeyHashHex56: operatorVkh,
    recipientVkeyHashHex56: recipientVkh,
    policyIdHex: policyId,
    assetNameHex: tokenNameHex,
    amount: amountUnits,
    lockNonce,
    recipientCommitmentHex: params.recipientCommitmentHex,
    sourceChainId,
    destinationChainId,
    bridgeOperatorVkeyHashHex56: operatorVkh,
  };
  const datumData = buildLockDatum(datum);

  const utxos1: UTxO[] = await wallet.getUtxos();
  const txB1 = new MeshTxBuilder({
    fetcher,
    submitter: fetcher,
    evaluator: fetcher as unknown as IEvaluator,
  });

  const lockAssets: Asset[] = [
    { unit: 'lovelace', quantity: adaStr },
    { unit: assetUnit, quantity: qtyStr },
  ];

  await txB1
    .mint(qtyStr, policyId, tokenNameHex)
    .mintingScript(forgingScript)
    .txOut(scriptAddr, lockAssets)
    .txOutInlineDatumValue(datumData)
    .changeAddress(change)
    .selectUtxosFrom(utxos1)
    .setNetwork(meshNetwork)
    .complete();

  const unsigned1 = txB1.txHex;
  const signed1 = await wallet.signTx(unsigned1);
  const lockTxHash = await wallet.submitTx(signed1);
  if (!lockTxHash) throw new Error('lock submitTx returned empty');

  const scriptUtxos = await fetcher.fetchAddressUTxOs(scriptAddr);
  const locked = scriptUtxos.find((u) => u.input.txHash === lockTxHash);
  if (!locked) {
    throw new Error(`Could not find lock UTxO at script after ${lockTxHash}`);
  }
  const lockTxHashOut = locked.input.txHash;
  const lockOutputIndex = locked.input.outputIndex;

  const walletUsed = (await wallet.getUsedAddresses())[0] ?? change;
  const collateralList = await wallet.getCollateral();
  const collateral = collateralList[0];
  if (!collateral) throw new Error('No collateral UTxO for Plutus release — fund a collateral UTxO on the bridge wallet');

  const utxos2: UTxO[] = await wallet.getUtxos();
  const payoutAddress = rec;

  const txB2 = new MeshTxBuilder({
    fetcher,
    submitter: fetcher,
    evaluator: fetcher as unknown as IEvaluator,
  });

  const signerHash =
    datum.bridgeOperatorVkeyHashHex56 === null ? datum.recipientVkeyHashHex56 : datum.bridgeOperatorVkeyHashHex56;

  await txB2
    .spendingPlutusScript('V3')
    .txIn(lockTxHashOut, lockOutputIndex, locked.output.amount, locked.output.address)
    .txInScript(scriptCbor)
    .txInRedeemerValue(redeemerBridgeRelease)
    .txInDatumValue(datumData)
    .requiredSignerHash(signerHash)
    .txOut(payoutAddress, locked.output.amount)
    .changeAddress(walletUsed)
    .txInCollateral(
      collateral.input.txHash,
      collateral.input.outputIndex,
      collateral.output.amount,
      collateral.output.address,
    )
    .selectUtxosFrom(utxos2)
    .setNetwork(meshNetwork)
    .complete();

  const unsigned2 = txB2.txHex;
  const signed2 = await wallet.signTx(unsigned2);
  const releaseTxHash = await wallet.submitTx(signed2);
  if (!releaseTxHash) throw new Error('release submitTx returned empty');

  return {
    lockTxHash,
    releaseTxHash,
    policyId,
    scriptAddress: scriptAddr,
    detail: `Aiken lock_pool: lock ${lockTxHash} → release ${releaseTxHash} (script ${scriptAddr.slice(0, 18)}…)`,
  };
}

/** Spend a lock UTxO with `BridgeRelease` (operator or recipient per datum). Use for BURN / unlock from Cardano source. */
export async function bridgeReleaseLockUtxo(params: {
  lockTxHash: string;
  lockOutputIndex: number;
  payoutBech32: string;
  logger: Logger;
}): Promise<{ txHash: string; detail: string }> {
  const ctx = await ensureCardanoBridgeWallet(params.logger);
  if (!ctx) throw new Error('Cardano bridge wallet not configured');

  const networkId = meshNetworkId();
  const payout = params.payoutBech32.trim();
  if (!cardanoRecipientMatchesNetwork(payout, networkId)) {
    throw new Error('Payout address network mismatch');
  }

  const { wallet, fetcher, meshNetwork } = ctx;
  const change = wallet.getChangeAddress();
  if (!change?.trim()) throw new Error('MeshWallet has no change address');

  const bp = loadBlueprint();
  const { scriptCbor } = getLockPoolScript(bp, networkId);

  const scriptUtxo = await fetchUtxo(fetcher, params.lockTxHash, params.lockOutputIndex);
  const rawDatum = scriptUtxo.output.plutusData;
  if (!rawDatum) {
    throw new Error(
      'Lock UTxO has no plutusData (inline datum). Indexers must return inline datum for lock outputs, or use lockMintThenBridgeRelease which spends immediately after lock.',
    );
  }

  let datumData: Data;
  try {
    datumData = deserializeDatum(rawDatum) as Data;
  } catch (e) {
    throw new Error(`Failed to deserialize lock datum: ${e instanceof Error ? e.message : String(e)}`);
  }

  const utxos = await wallet.getUtxos();
  const walletUsed = (await wallet.getUsedAddresses())[0] ?? change;
  const collateralList = await wallet.getCollateral();
  const collateral = collateralList[0];
  if (!collateral) throw new Error('No collateral UTxO for Plutus release');

  const datumParams = lockDatumParamsFromMeshData(datumData);
  const signerHash =
    datumParams.bridgeOperatorVkeyHashHex56 === null
      ? datumParams.recipientVkeyHashHex56
      : datumParams.bridgeOperatorVkeyHashHex56;

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
    .txInScript(scriptCbor)
    .txInRedeemerValue(redeemerBridgeRelease)
    .txInDatumValue(datumData)
    .requiredSignerHash(signerHash)
    .txOut(payout, scriptUtxo.output.amount)
    .changeAddress(walletUsed)
    .txInCollateral(
      collateral.input.txHash,
      collateral.input.outputIndex,
      collateral.output.amount,
      collateral.output.address,
    )
    .selectUtxosFrom(utxos)
    .setNetwork(meshNetwork)
    .complete();

  const unsigned = txB.txHex;
  const signed = await wallet.signTx(unsigned);
  const txHash = await wallet.submitTx(signed);
  if (!txHash) throw new Error('submitTx returned empty');
  return {
    txHash,
    detail: `Aiken lock_pool BridgeRelease: ${txHash}`,
  };
}

/** Parse `LockDatum` from Mesh `deserializeDatum` (`alternative` + `fields`). */
function lockDatumParamsFromMeshData(d: Data): LockDatumParams {
  const root = d as unknown as { alternative: number; fields: Data[] };
  const f = root.fields;
  if (!Array.isArray(f) || f.length < 10) {
    throw new Error('Unexpected LockDatum shape from chain');
  }
  const opField = f[9] as unknown as { alternative: number; fields: Data[] };
  let bridgeOperatorVkeyHashHex56: string | null = null;
  if (opField.alternative === 0 && opField.fields?.length === 1) {
    bridgeOperatorVkeyHashHex56 = String(opField.fields[0]);
  } else if (opField.alternative === 1) {
    bridgeOperatorVkeyHashHex56 = null;
  } else {
    throw new Error('Unexpected bridge_operator option in LockDatum');
  }
  return {
    depositorVkeyHashHex56: String(f[0]),
    recipientVkeyHashHex56: String(f[1]),
    policyIdHex: String(f[2]),
    assetNameHex: String(f[3]),
    amount: BigInt(String(f[4])),
    lockNonce: BigInt(String(f[5])),
    recipientCommitmentHex: String(f[6]),
    sourceChainId: BigInt(String(f[7])),
    destinationChainId: BigInt(String(f[8])),
    bridgeOperatorVkeyHashHex56,
  };
}
