import { BrowserWallet, deserializeDatum } from '@meshsdk/core';
import type { Data } from '@meshsdk/common';
import { formatUnits } from 'viem';
import { createBrowserCardanoIndexer } from './meshCardanoIndexer.js';
import { parseLockDatumFromMeshData, type LockDatumParams } from './lockDatumParse.js';
import { fetchCardanoBridgeMetadata } from './bridgeMetadata.js';
import { walletPaymentKeyHashSet } from './walletPaymentAddresses.js';

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
  relayerBaseUrl: string;
  asset: 'USDC' | 'USDT';
}): Promise<CardanoBridgeLockCandidate[]> {
  const wusdc = String(import.meta.env.VITE_CARDANO_WUSDC_UNIT ?? '')
    .trim()
    .toLowerCase();
  const wusdt = String(import.meta.env.VITE_CARDANO_WUSDT_UNIT ?? '')
    .trim()
    .toLowerCase();
  const unit = opts.asset === 'USDC' ? wusdc : wusdt;
  if (!unit) return [];

  const meta = await fetchCardanoBridgeMetadata(opts.relayerBaseUrl);
  const fetcher = createBrowserCardanoIndexer();

  const wallet = await BrowserWallet.enable(opts.cip30WalletKey);
  const walletVkhs = await walletPaymentKeyHashSet(wallet);
  if (walletVkhs.size === 0) return [];

  const utxos = await fetcher.fetchAddressUTxOs(meta.lockScriptAddress, unit);
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
    if (datumNativeUnit(p) !== unit) continue;

    const txHash = normalizeTxHash(u.input.txHash);
    const k = `${txHash}#${u.input.outputIndex}`;
    if (seen.has(k)) continue;
    seen.add(k);

    out.push({
      txHash,
      outputIndex: u.input.outputIndex,
      assetLabel: opts.asset,
      amountFormatted: formatUnits(p.amount, 6),
    });
  }

  return out;
}
