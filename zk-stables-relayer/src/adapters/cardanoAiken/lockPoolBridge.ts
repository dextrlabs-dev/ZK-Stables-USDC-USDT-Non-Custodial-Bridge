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
import {
  assertBridgeWalletMinLovelace,
  ensureCardanoBridgeWallet,
  cardanoRecipientMatchesNetwork,
} from '../cardanoPayout.js';
import { cardanoBridgeTokenName } from '../cardanoMintPayout.js';
import { loadBlueprint } from './blueprint.js';
import { parseLockDatumFromMeshData } from './cardanoLockDatum.js';
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

/** Yaci Store / Blockfrost often lags right after submit; immediate `fetchAddressUTxOs` misses the new script UTxO. */
async function waitForLockUtxoAtScript(params: {
  fetcher: IFetcher;
  scriptAddr: string;
  lockTxHash: string;
  logger: Logger;
}): Promise<UTxO> {
  const waitMs = Math.max(1000, Number(process.env.RELAYER_CARDANO_LOCK_UTXO_WAIT_MS ?? 90_000));
  const pollMs = Math.max(100, Number(process.env.RELAYER_CARDANO_LOCK_UTXO_POLL_MS ?? 500));
  const deadline = Date.now() + waitMs;
  const want = params.lockTxHash.trim().toLowerCase();
  let attempt = 0;
  while (Date.now() < deadline) {
    attempt += 1;
    const scriptUtxos = await params.fetcher.fetchAddressUTxOs(params.scriptAddr);
    const locked = scriptUtxos.find((u) => u.input.txHash.toLowerCase() === want);
    if (locked) {
      if (attempt > 1) {
        params.logger.info({ lockTxHash: params.lockTxHash, attempts: attempt }, 'lock UTxO visible at script after indexer catch-up');
      }
      return locked;
    }
    params.logger.debug(
      { lockTxHash: params.lockTxHash, scriptAddr: params.scriptAddr, atScript: scriptUtxos.length, attempt },
      'lock UTxO not in indexer yet; polling',
    );
    await new Promise((r) => setTimeout(r, pollMs));
  }
  throw new Error(
    `Could not find lock UTxO at script after ${params.lockTxHash} within ${waitMs}ms (Yaci Store lag, wrong script address, or lock tx failed). Increase RELAYER_CARDANO_LOCK_UTXO_WAIT_MS or RELAYER_CARDANO_LOCK_UTXO_POLL_MS.`,
  );
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

  const envPref = process.env.RELAYER_CARDANO_PREFLIGHT_MIN_LOVELACE?.trim();
  const minWalletLovelace =
    envPref && /^[0-9]+$/u.test(envPref)
      ? BigInt(envPref)
      : (lovelaceOut > minAda ? lovelaceOut : minAda) + 3_500_000n;
  await assertBridgeWalletMinLovelace({
    wallet,
    minLovelace: minWalletLovelace,
    changeAddress: change,
    logger: params.logger,
  });

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

  const locked = await waitForLockUtxoAtScript({
    fetcher,
    scriptAddr,
    lockTxHash,
    logger: params.logger,
  });
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
    // Conway: inline datum on the UTxO must not be duplicated as a supplemental witness datum
    .txInInlineDatumPresent()
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

/**
 * Mint bridge tokens and lock at `lock_pool` with **no** `bridge_operator` in datum — the **recipient** can `BridgeRelease`
 * with their own wallet (user-signed path). Relayer does not submit the release tx.
 * Enable for LOCK→Cardano demos via `RELAYER_CARDANO_DESTINATION_LOCK_HOLD=true`.
 */
export async function lockMintHoldAtScriptOnly(params: {
  recipientBech32: string;
  amountStr: string;
  asset: 'USDC' | 'USDT';
  recipientCommitmentHex: string;
  logger: Logger;
  /** When true, the wallet's own key hash is set as `bridgeOperatorVkeyHashHex56` in the datum so it can sign BridgeRelease. */
  operatorCanRelease?: boolean;
}): Promise<{ lockTxHash: string; lockOutputIndex: number; policyId: string; scriptAddress: string; detail: string }> {
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

  const envPref = process.env.RELAYER_CARDANO_PREFLIGHT_MIN_LOVELACE?.trim();
  const minWalletLovelace =
    envPref && /^[0-9]+$/u.test(envPref)
      ? BigInt(envPref)
      : (lovelaceOut > minAda ? lovelaceOut : minAda) + 3_500_000n;
  await assertBridgeWalletMinLovelace({
    wallet,
    minLovelace: minWalletLovelace,
    changeAddress: change,
    logger: params.logger,
  });

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
    bridgeOperatorVkeyHashHex56: params.operatorCanRelease ? operatorVkh : null,
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

  const signed1 = await wallet.signTx(txB1.txHex);
  const lockTxHash = await wallet.submitTx(signed1);
  if (!lockTxHash) throw new Error('lock submitTx returned empty');

  const locked = await waitForLockUtxoAtScript({
    fetcher,
    scriptAddr,
    lockTxHash,
    logger: params.logger,
  });

  return {
    lockTxHash: locked.input.txHash,
    lockOutputIndex: locked.input.outputIndex,
    policyId,
    scriptAddress: scriptAddr,
    detail: `Aiken lock_pool (hold): locked at ${locked.input.txHash}#${locked.input.outputIndex} — recipient may BridgeRelease (no operator in datum)`,
  };
}

/** Spend a lock UTxO with `BridgeRelease` (operator or recipient per datum). Use for BURN / unlock from Cardano source. */
export async function bridgeReleaseLockUtxo(params: {
  lockTxHash: string;
  lockOutputIndex: number;
  payoutBech32: string;
  logger: Logger;
  /**
   * `burn` (default): redeem semantics — synthetic zk is removed from circulation via negative mint;
   * payout receives only lovelace (and any non-bridge assets) from the lock output.
   * `transfer`: legacy — full script value (including zk) is sent to `payoutBech32`.
   */
  releaseMode?: 'burn' | 'transfer';
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

  const datumParams = parseLockDatumFromMeshData(datumData);
  const signerHash =
    datumParams.bridgeOperatorVkeyHashHex56 === null
      ? datumParams.recipientVkeyHashHex56
      : datumParams.bridgeOperatorVkeyHashHex56;

  const releaseMode = params.releaseMode ?? 'burn';
  const forgingScript = ForgeScript.withOneSignature(change);
  const forgingPolicyId = resolveScriptHash(forgingScript);

  const txB = new MeshTxBuilder({
    fetcher,
    submitter: fetcher,
    evaluator: fetcher as unknown as IEvaluator,
  });

  const spendHead = txB
    .spendingPlutusScript('V3')
    .txIn(
      scriptUtxo.input.txHash,
      scriptUtxo.input.outputIndex,
      scriptUtxo.output.amount,
      scriptUtxo.output.address,
    )
    .txInScript(scriptCbor)
    .txInRedeemerValue(redeemerBridgeRelease)
    .txInInlineDatumPresent()
    .requiredSignerHash(signerHash);

  if (releaseMode === 'transfer') {
    await spendHead
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
  } else {
    if (datumParams.policyIdHex !== forgingPolicyId) {
      throw new Error(
        `Lock datum forging policy does not match bridge wallet policy — cannot burn (datum ${datumParams.policyIdHex.slice(0, 14)}… vs wallet ${forgingPolicyId.slice(0, 14)}…)`,
      );
    }
    const bridgeUnit = `${datumParams.policyIdHex}${datumParams.assetNameHex}`;
    const bridgeRow = scriptUtxo.output.amount.find((a) => a.unit === bridgeUnit);
    if (!bridgeRow) {
      throw new Error(
        `Lock UTxO has no synthetic asset ${bridgeUnit.slice(0, 20)}… (expected from datum); cannot BridgeRelease+burn`,
      );
    }
    const burnQty = BigInt(String(bridgeRow.quantity));
    if (burnQty <= 0n) throw new Error('BridgeRelease+burn: synthetic quantity must be positive');

    const payoutAssets: Asset[] = scriptUtxo.output.amount
      .filter((a) => a.unit !== bridgeUnit)
      .map((a) => ({ unit: a.unit, quantity: String(a.quantity) }));
    if (payoutAssets.length === 0) {
      throw new Error('BridgeRelease+burn: no outputs left after stripping synthetic (lock UTxO must carry lovelace)');
    }

    await spendHead
      .txOut(payout, payoutAssets)
      .mint(`-${burnQty.toString()}`, datumParams.policyIdHex, datumParams.assetNameHex)
      .mintingScript(forgingScript)
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
  }

  const unsigned = txB.txHex;
  const signed = await wallet.signTx(unsigned);
  const txHash = await wallet.submitTx(signed);
  if (!txHash) throw new Error('submitTx returned empty');
  const detail =
    releaseMode === 'burn'
      ? `Aiken lock_pool BridgeRelease+burn (supply): ${txHash}`
      : `Aiken lock_pool BridgeRelease: ${txHash}`;
  return { txHash, detail };
}

