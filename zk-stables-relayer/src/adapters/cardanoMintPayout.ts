/**
 * Cardano **WUSDC / WUSDT** bridge assets: **mint** (credit) and **burn** (destroy supply) only — Mesh native scripts
 * (`ForgeScript.withOneSignature` + `.mint()` / negative mint for burn). See
 * https://meshjs.dev/apis/txbuilder/minting
 *
 * Treasury transfer of pre-existing assets is not used for bridge settlement (`cardanoPayoutToRecipient` is unrelated).
 */
import { ForgeScript, MeshTxBuilder, resolveScriptHash, stringToHex } from '@meshsdk/core';
import type { Asset, IEvaluator, IFetcher, ISubmitter, UTxO } from '@meshsdk/common';
import type { Logger } from 'pino';
import { ensureCardanoBridgeWallet, cardanoRecipientMatchesNetwork } from './cardanoPayout.js';

/** ASCII asset name for native mint/burn (WUSDC / WUSDT unless `RELAYER_CARDANO_MINT_TOKEN_NAME` overrides both). */
export function cardanoBridgeTokenName(asset: 'USDC' | 'USDT'): string {
  const o = process.env.RELAYER_CARDANO_MINT_TOKEN_NAME?.trim();
  if (o) return o;
  return asset === 'USDT' ? 'WUSDT' : 'WUSDC';
}

/** Burn synthetic supply held by the bridge wallet (negative mint). Operator must hold the asset in UTxOs. */
export async function cardanoBurnNativeFromOperator(params: {
  asset: 'USDC' | 'USDT';
  quantity: bigint;
  logger: Logger;
}): Promise<{ txHash: string; policyId: string; assetUnit: string; tokenName: string }> {
  const ctx = await ensureCardanoBridgeWallet(params.logger);
  if (!ctx) throw new Error('Cardano bridge wallet not configured');

  const { wallet, fetcher, meshNetwork } = ctx;
  const utxos: UTxO[] = await wallet.getUtxos();
  const change = wallet.getChangeAddress();
  if (!change?.trim()) throw new Error('MeshWallet has no change address');

  if (params.quantity <= 0n) throw new Error('Burn quantity must be positive');

  const tokenNameAscii = cardanoBridgeTokenName(params.asset);
  const forgingScript = ForgeScript.withOneSignature(change);
  const policyId = resolveScriptHash(forgingScript);
  const tokenNameHex = stringToHex(tokenNameAscii);
  const assetUnit = `${policyId}${tokenNameHex}`;
  const qtyStr = params.quantity.toString();

  const txBuilder = new MeshTxBuilder({
    fetcher,
    submitter: fetcher,
    evaluator: fetcher as unknown as IEvaluator,
  });

  await txBuilder
    .mint(`-${qtyStr}`, policyId, tokenNameHex)
    .mintingScript(forgingScript)
    .changeAddress(change)
    .selectUtxosFrom(utxos)
    .setNetwork(meshNetwork)
    .complete();

  const unsigned = txBuilder.txHex;
  const signed = await wallet.signTx(unsigned);
  const txHash = await wallet.submitTx(signed);
  if (!txHash) throw new Error('submitTx returned empty');
  return { txHash, policyId, assetUnit, tokenName: tokenNameAscii };
}

export async function cardanoMintNativeToRecipient(params: {
  recipientBech32: string;
  /** ASCII token name, e.g. WUSDC / WUSDT (hex name via stringToHex). */
  tokenNameAscii: string;
  /** Smallest units (same decimals as RELAYER_CARDANO_ASSET_DECIMALS). */
  quantity: bigint;
  /** Lovelace in the output beside the minted asset (min-ADA for token UTxO). */
  lovelaceInOutput: bigint;
  logger: Logger;
}): Promise<{ txHash: string; policyId: string; assetUnit: string }> {
  const ctx = await ensureCardanoBridgeWallet(params.logger);
  if (!ctx) throw new Error('Cardano bridge wallet not configured');

  const networkId = Number(process.env.RELAYER_CARDANO_NETWORK_ID ?? process.env.CARDANO_NETWORK_ID ?? 0) as 0 | 1;
  const rec = params.recipientBech32.trim();
  if (!cardanoRecipientMatchesNetwork(rec, networkId)) {
    throw new Error('Cardano recipient network mismatch (see RELAYER_CARDANO_NETWORK_ID)');
  }

  const { wallet, fetcher, meshNetwork } = ctx;
  const utxos: UTxO[] = await wallet.getUtxos();
  const change = wallet.getChangeAddress();
  if (!change?.trim()) throw new Error('MeshWallet has no change address');

  if (params.quantity <= 0n) throw new Error('Mint quantity must be positive');

  const forgingScript = ForgeScript.withOneSignature(change);
  const policyId = resolveScriptHash(forgingScript);
  const tokenNameHex = stringToHex(params.tokenNameAscii.trim());
  const assetUnit = `${policyId}${tokenNameHex}`;
  const qtyStr = params.quantity.toString();

  const outAssets: Asset[] = [
    { unit: 'lovelace', quantity: params.lovelaceInOutput.toString() },
    { unit: assetUnit, quantity: qtyStr },
  ];

  const txBuilder = new MeshTxBuilder({
    fetcher,
    submitter: fetcher,
    evaluator: fetcher as unknown as IEvaluator,
  });

  await txBuilder
    .mint(qtyStr, policyId, tokenNameHex)
    .mintingScript(forgingScript)
    .txOut(rec, outAssets)
    .changeAddress(change)
    .selectUtxosFrom(utxos)
    .setNetwork(meshNetwork)
    .complete();

  const unsigned = txBuilder.txHex;
  const signed = await wallet.signTx(unsigned);
  const txHash = await wallet.submitTx(signed);
  if (!txHash) throw new Error('submitTx returned empty');
  return { txHash, policyId, assetUnit };
}
