import { deserializeDatum } from '@meshsdk/core';
import type { Data } from '@meshsdk/common';
import { formatUnits } from 'viem';
import { createBrowserCardanoIndexer, resolveBrowserYaciMeshApiBase } from './meshCardanoIndexer.js';
import { fetchAddressUtxosBlockfrostDirect } from '../lib/yaciAddressBalance.js';
import { parseLockDatumFromMeshData, type LockDatumParams } from './lockDatumParse.js';
import { fetchCardanoBridgeMetadata } from './bridgeMetadata.js';
import { cardanoNativeUnitsEquivalent } from './cardanoNativeUnitMatch.js';
import { walletPaymentKeyHashSet } from './walletPaymentAddresses.js';
import { resolveBridgeSigningWallet } from './resolveBridgeSigningWallet.js';

export type CardanoBridgeLockCandidate = {
  txHash: string;
  outputIndex: number;
  assetLabel: 'USDC' | 'USDT';
  amountFormatted: string;
};

function normalizeTxHash(h: string): string {
  return h.replace(/^0x/i, '').trim();
}

function datumNativeUnit(p: LockDatumParams): string {
  const pol = p.policyIdHex.replace(/^0x/i, '').toLowerCase();
  const name = p.assetNameHex.replace(/^0x/i, '').toLowerCase();
  return `${pol}${name}`;
}

/**
 * Find recipient-only bridge lock UTxOs at the relayer script that pay to the connected wallet
 * and hold the configured zk native unit (VITE_CARDANO_WUSDC_UNIT / WUSDT).
 */
export async function discoverCardanoBridgeLocks(opts: {
  cip30WalletKey: string;
  useDemoMnemonicWallet?: boolean;
  relayerBaseUrl: string;
  asset: 'USDC' | 'USDT';
}): Promise<CardanoBridgeLockCandidate[]> {
  const wusdc = String(import.meta.env.VITE_CARDANO_WUSDC_UNIT ?? '')
    .trim()
    .toLowerCase();
  const wusdt = String(import.meta.env.VITE_CARDANO_WUSDT_UNIT ?? '')
    .trim()
    .toLowerCase();
  /** Env may list both; the bridge `asset` dropdown may not match the token you locked — scan both. */
  const allowedUnits: string[] = [];
  if (wusdc) allowedUnits.push(wusdc);
  if (wusdt) allowedUnits.push(wusdt);
  if (allowedUnits.length === 0) return [];

  const meta = await fetchCardanoBridgeMetadata(opts.relayerBaseUrl);
  const fetcher = createBrowserCardanoIndexer();

  const wallet = await resolveBridgeSigningWallet({
    cip30WalletKey: opts.cip30WalletKey,
    useDemoMnemonicWallet: Boolean(opts.useDemoMnemonicWallet),
  });
  const walletVkhs = await walletPaymentKeyHashSet(wallet);
  if (walletVkhs.size === 0) return [];

  /**
   * Prefer direct Blockfrost HTTP: Mesh `YaciProvider.fetchAddressUTxOs` catches failures and returns
   * `[]` if **any** output fails to map (e.g. reference script resolution), hiding valid locks.
   */
  const bfBase = resolveBrowserYaciMeshApiBase();
  let allAtScript: Awaited<ReturnType<typeof fetcher.fetchAddressUTxOs>>;
  if (bfBase) {
    try {
      allAtScript = await fetchAddressUtxosBlockfrostDirect(bfBase, meta.lockScriptAddress);
    } catch {
      allAtScript = await fetcher.fetchAddressUTxOs(meta.lockScriptAddress);
    }
  } else {
    allAtScript = await fetcher.fetchAddressUTxOs(meta.lockScriptAddress);
  }
  const utxos = allAtScript.filter((u) =>
    u.output.amount.some((a) => allowedUnits.some((unit) => cardanoNativeUnitsEquivalent(a.unit, unit))),
  );
  const seen = new Set<string>();
  const out: CardanoBridgeLockCandidate[] = [];

  for (const u of utxos) {
    const raw = u.output.plutusData;
    if (!raw) continue;
    let datumData: Data;
    try {
      datumData = deserializeDatum(raw) as Data;
    } catch {
      continue;
    }
    let p: LockDatumParams;
    try {
      p = parseLockDatumFromMeshData(datumData);
    } catch {
      continue;
    }
    if (p.bridgeOperatorVkeyHashHex56 !== null) continue;
    const recip = p.recipientVkeyHashHex56.replace(/^0x/i, '').trim().toLowerCase();
    if (!walletVkhs.has(recip)) continue;

    const datumUnit = datumNativeUnit(p);
    let assetLabel: 'USDC' | 'USDT' | null = null;
    if (wusdc && cardanoNativeUnitsEquivalent(datumUnit, wusdc)) assetLabel = 'USDC';
    else if (wusdt && cardanoNativeUnitsEquivalent(datumUnit, wusdt)) assetLabel = 'USDT';
    if (!assetLabel) continue;

    const txHash = normalizeTxHash(u.input.txHash);
    const k = `${txHash}#${u.input.outputIndex}`;
    if (seen.has(k)) continue;
    seen.add(k);

    out.push({
      txHash,
      outputIndex: u.input.outputIndex,
      assetLabel,
      amountFormatted: formatUnits(p.amount, 6),
    });
  }

  /** Prefer locks matching the current bridge asset dropdown so the first row matches zkSymbol. */
  out.sort((a, b) => {
    const pa = a.assetLabel === opts.asset ? 0 : 1;
    const pb = b.assetLabel === opts.asset ? 0 : 1;
    return pa - pb;
  });

  return out;
}
