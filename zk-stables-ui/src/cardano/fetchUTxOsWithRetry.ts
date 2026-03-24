import type { IFetcher, UTxO } from '@meshsdk/common';
import { fetchTxUtxosBlockfrostDirect } from '../lib/yaciAddressBalance.js';
import { resolveBrowserYaciMeshApiBase } from './meshCardanoIndexer.js';

function toSearchableString(e: unknown): string {
  if (typeof e === 'string') return e;
  if (e instanceof Error) return e.message;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

/** Yaci Store / Blockfrost often return 404 until the tx appears in the indexer. */
export function isLikelyIndexerLagError(e: unknown): boolean {
  const s = toSearchableString(e);
  return (
    /"status"\s*:\s*404\b/.test(s) ||
    /\b404\b/.test(s) && /not found|Transaction not found/i.test(s) ||
    /Transaction not found/i.test(s)
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** When Mesh `YaciProvider.fetchUTxOs` throws or returns [] due to a bad output in the batch, same-origin HTTP still returns JSON. */
async function fetchTxUtxosViaDirectIfPossible(
  normalized: string,
  outputIndex: number | undefined,
): Promise<UTxO[]> {
  const bf = resolveBrowserYaciMeshApiBase();
  if (!bf) return [];
  try {
    let utxos = await fetchTxUtxosBlockfrostDirect(bf, normalized);
    if (outputIndex !== undefined) {
      utxos = utxos.filter((u) => u.input.outputIndex === outputIndex);
    }
    return utxos;
  } catch {
    return [];
  }
}

/**
 * Poll `fetchUTxOs` until outputs exist or attempts exhaust.
 * Use after `submitTx` and when loading a lock UTxO that may not be indexed yet.
 */
export async function fetchUTxOsWithRetry(
  fetcher: IFetcher,
  txHash: string,
  outputIndex: number | undefined,
  context: string,
): Promise<UTxO[]> {
  const normalized = txHash.replace(/^0x/i, '').trim().toLowerCase();
  const maxAttempts = 20;
  let waitMs = 350;
  let lastErr: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let utxos: UTxO[] = [];
    try {
      utxos = await fetcher.fetchUTxOs(normalized, outputIndex);
    } catch (e) {
      lastErr = e;
      const direct = await fetchTxUtxosViaDirectIfPossible(normalized, outputIndex);
      if (direct.length > 0) return direct;
      if (!isLikelyIndexerLagError(e)) throw e;
    }
    if (utxos.length > 0) return utxos;
    const directEmpty = await fetchTxUtxosViaDirectIfPossible(normalized, outputIndex);
    if (directEmpty.length > 0) return directEmpty;
    lastErr = new Error(`empty UTxO list for ${normalized}`);
    if (attempt < maxAttempts) {
      await sleep(waitMs);
      waitMs = Math.min(Math.round(waitMs * 1.35), 3200);
    }
  }

  throw new Error(
    `${context}: indexer still has no UTxOs for ${normalized} after ~${maxAttempts} attempts (Yaci/Blockfrost can lag right after submit). ` +
      `Confirm the tx is on-chain, VITE_YACI_URL / proxy matches your node, then retry. Detail: ${toSearchableString(lastErr)}`,
  );
}
