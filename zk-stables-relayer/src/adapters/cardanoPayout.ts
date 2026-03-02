/**
 * Cardano settlement: send lovelace and/or a native asset from a relayer mnemonic wallet to a bech32 recipient.
 * Uses Mesh (same stack as `cardano/ts`). This is **transfer-only** (lovelace + optional existing native asset from the
 * operator wallet). Bridge settlement for WUSDC/WUSDT uses mint/burn only — see `cardanoMintPayout.ts`.
 */
import { BlockfrostProvider, MeshTxBuilder, MeshWallet, YaciProvider } from '@meshsdk/core';
import type { Asset, IFetcher, IEvaluator, ISubmitter, Network, UTxO } from '@meshsdk/common';
import type { Logger } from 'pino';
import { blockfrostProjectId, resolveYaciBaseUrl } from './cardanoIndexer.js';

export function isCardanoBridgeEnabled(): boolean {
  return process.env.RELAYER_CARDANO_BRIDGE_ENABLED === 'true' || process.env.RELAYER_CARDANO_BRIDGE_ENABLED === '1';
}

export function looksLikeCardanoAddress(addr: string): boolean {
  const t = addr.trim();
  return t.startsWith('addr1') || t.startsWith('addr_test1');
}

/** Shelley bech32 must match `RELAYER_CARDANO_NETWORK_ID` or Mesh tx build fails with Base58Error / UnknownSymbol. */
export function cardanoRecipientMatchesNetwork(addr: string, networkId: 0 | 1): boolean {
  const t = addr.trim();
  if (networkId === 1) return t.startsWith('addr1') && !t.startsWith('addr_test1');
  return t.startsWith('addr_test1');
}

function mnemonicWords(): string[] | null {
  const raw = (process.env.RELAYER_CARDANO_WALLET_MNEMONIC ?? process.env.CARDANO_WALLET_MNEMONIC ?? '').trim();
  if (!raw) return null;
  return raw.split(/\s+/u);
}

function createFetcherSubmitter(): (IFetcher & ISubmitter) | null {
  const yaci = resolveYaciBaseUrl();
  const admin = (process.env.RELAYER_YACI_ADMIN_URL ?? process.env.YACI_ADMIN_URL ?? '').trim();
  const bf = blockfrostProjectId();
  if (yaci) return new YaciProvider(yaci, admin || undefined) as IFetcher & ISubmitter;
  if (bf) return new BlockfrostProvider(bf) as IFetcher & ISubmitter;
  return null;
}

type BridgeCtx = { wallet: MeshWallet; fetcher: IFetcher & ISubmitter; meshNetwork: Network };

let cached: Promise<BridgeCtx | null> | null = null;

export function ensureCardanoBridgeWallet(logger: Logger): Promise<BridgeCtx | null> {
  if (!isCardanoBridgeEnabled()) return Promise.resolve(null);
  if (!cached) {
    cached = (async (): Promise<BridgeCtx | null> => {
      const words = mnemonicWords();
      const fs = createFetcherSubmitter();
      if (!words || !fs) {
        logger.warn(
          'RELAYER_CARDANO_BRIDGE_ENABLED but missing RELAYER_CARDANO_WALLET_MNEMONIC (or CARDANO_WALLET_MNEMONIC) or Cardano API (RELAYER_YACI_URL / YACI_URL or RELAYER_BLOCKFROST_PROJECT_ID)',
        );
        return null;
      }
      const networkId = Number(process.env.RELAYER_CARDANO_NETWORK_ID ?? process.env.CARDANO_NETWORK_ID ?? 0) as 0 | 1;
      const meshNetwork = (process.env.RELAYER_CARDANO_MESH_NETWORK ?? process.env.CARDANO_MESH_NETWORK ?? 'preprod') as Network;
      const wallet = new MeshWallet({
        networkId,
        fetcher: fs,
        submitter: fs,
        key: { type: 'mnemonic', words },
      });
      return { wallet, fetcher: fs, meshNetwork };
    })().catch((e) => {
      cached = null;
      throw e;
    });
  }
  return cached;
}

export async function cardanoPayoutToRecipient(params: {
  recipientBech32: string;
  lovelace: bigint;
  assetUnit?: string;
  assetQuantity?: bigint;
  logger: Logger;
}): Promise<{ txHash: string }> {
  const ctx = await ensureCardanoBridgeWallet(params.logger);
  if (!ctx) throw new Error('Cardano bridge wallet not configured');

  const networkId = Number(process.env.RELAYER_CARDANO_NETWORK_ID ?? process.env.CARDANO_NETWORK_ID ?? 0) as 0 | 1;
  const rec = params.recipientBech32.trim();
  if (!cardanoRecipientMatchesNetwork(rec, networkId)) {
    throw new Error(
      networkId === 0
        ? `Cardano recipient must be testnet bech32 (addr_test1…). Mainnet addr1… breaks Mesh with RELAYER_CARDANO_NETWORK_ID=0 / Yaci. Got: ${rec.slice(0, 24)}…`
        : `Cardano recipient must be mainnet addr1… for RELAYER_CARDANO_NETWORK_ID=1. Got: ${rec.slice(0, 24)}…`,
    );
  }

  const { wallet, fetcher, meshNetwork } = ctx;
  const utxos: UTxO[] = await wallet.getUtxos();
  const change = wallet.getChangeAddress();
  if (!change?.trim()) {
    throw new Error('MeshWallet has no change address — check RELAYER_CARDANO_WALLET_MNEMONIC and network id');
  }
  if (!cardanoRecipientMatchesNetwork(change, networkId)) {
    throw new Error(
      'Operator change address network does not match RELAYER_CARDANO_NETWORK_ID (use a testnet mnemonic with networkId 0)',
    );
  }

  const minAdaWithToken = 2_000_000n;
  const assets: Asset[] = [];
  const ada =
    params.assetUnit && params.assetQuantity !== undefined && params.assetQuantity > 0n
      ? params.lovelace > minAdaWithToken
        ? params.lovelace
        : minAdaWithToken
      : params.lovelace;
  assets.push({ unit: 'lovelace', quantity: ada.toString() });
  if (params.assetUnit && params.assetQuantity !== undefined && params.assetQuantity > 0n) {
    assets.push({ unit: params.assetUnit, quantity: params.assetQuantity.toString() });
  }

  const txBuilder = new MeshTxBuilder({
    fetcher,
    submitter: fetcher,
    evaluator: fetcher as unknown as IEvaluator,
  });

  await txBuilder
    .txOut(params.recipientBech32.trim(), assets)
    .changeAddress(change)
    .selectUtxosFrom(utxos)
    .setNetwork(meshNetwork)
    .complete();

  const unsigned = txBuilder.txHex;
  const signed = await wallet.signTx(unsigned);
  const txHash = await wallet.submitTx(signed);
  if (!txHash) throw new Error('submitTx returned empty');
  return { txHash };
}
