import type { UTxO } from '@meshsdk/common';
import { cardanoNativeUnitsEquivalent } from '../cardano/cardanoNativeUnitMatch.js';

/**
 * Avoid stale reads after burns/mints: no HTTP cache, plus cache-control headers for intermediaries.
 * (Some browsers still revalidate aggressively; `no-store` is the primary fix.)
 */
const yaciFetchInit: RequestInit = {
  cache: 'no-store',
  headers: {
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    Pragma: 'no-cache',
  },
};

async function readYaciErrorBody(r: Response): Promise<string> {
  try {
    const t = await r.text();
    return t.trim().slice(0, 400);
  } catch {
    return '';
  }
}

/** Blockfrost-compatible base URL for browser fetches (handles Vite `/yaci-store` proxy). */
export function resolveYaciStoreBaseUrl(): string | null {
  const raw = import.meta.env.VITE_YACI_STORE_URL?.trim();
  if (!raw) return null;
  if (raw.startsWith('/')) {
    if (typeof window === 'undefined') return null;
    return `${window.location.origin}${raw}`;
  }
  return raw;
}

/**
 * Sum ADA (lovelace) for a bech32 address via Yaci Store Blockfrost-compatible API.
 * Same pagination as zk-stables-relayer `yaciAddressUtxos`.
 */
export async function fetchYaciAddressAda(params: { yaciStoreBaseUrl: string; bech32: string }): Promise<string> {
  const base = params.yaciStoreBaseUrl.trim().replace(/\/+$/u, '');
  const enc = encodeURIComponent(params.bech32.trim());
  let totalLovelace = 0n;

  for (let page = 1; page < 10_000; page++) {
    const r = await fetch(`${base}/addresses/${enc}/utxos?page=${page}`, yaciFetchInit);
    if (!r.ok) {
      const detail = await readYaciErrorBody(r);
      const hint =
        r.status === 503 || r.status === 502 || r.status === 500
          ? ' Start Yaci Store on http://127.0.0.1:8080 (or set VITE_YACI_STORE_URL to a running API). See docs/CARDANO_LOCAL_YACI.md.'
          : '';
      throw new Error(
        `Yaci Store UTxOs: HTTP ${r.status}${detail ? ` — ${detail}` : ''}.${hint}`,
      );
    }
    const j = (await r.json()) as unknown;
    if (!Array.isArray(j)) {
      throw new Error('Yaci Store: unexpected UTxO response');
    }
    if (j.length === 0) break;
    for (const u of j as Array<{ amount?: Array<{ unit: string; quantity: string }> }>) {
      const ada = u.amount?.find((a) => a.unit === 'lovelace');
      if (ada) totalLovelace += BigInt(ada.quantity);
    }
  }

  return formatAdaFromLovelace(totalLovelace);
}

/**
 * Sum a native asset (`unit` = policyId + assetName hex) for an address via paginated UTxOs.
 */
export async function fetchYaciAddressNativeAssetQuantity(params: {
  yaciStoreBaseUrl: string;
  bech32: string;
  assetUnit: string;
}): Promise<bigint> {
  const base = params.yaciStoreBaseUrl.trim().replace(/\/+$/u, '');
  const enc = encodeURIComponent(params.bech32.trim());
  const unit = params.assetUnit.trim();
  if (!unit) return 0n;
  const target = unit.toLowerCase();
  let total = 0n;

  for (let page = 1; page < 10_000; page++) {
    const r = await fetch(`${base}/addresses/${enc}/utxos?page=${page}`, yaciFetchInit);
    if (!r.ok) {
      const detail = await readYaciErrorBody(r);
      const hint =
        r.status === 503 || r.status === 502 || r.status === 500
          ? ' Start Yaci on :8080 or fix VITE_YACI_STORE_URL. See docs/CARDANO_LOCAL_YACI.md.'
          : '';
      throw new Error(`Yaci Store UTxOs: HTTP ${r.status}${detail ? ` — ${detail}` : ''}.${hint}`);
    }
    const j = (await r.json()) as unknown;
    if (!Array.isArray(j)) throw new Error('Yaci Store: unexpected UTxO response');
    if (j.length === 0) break;
    for (const u of j as Array<{ amount?: Array<{ unit: string; quantity: string }> }>) {
      for (const x of u.amount ?? []) {
        if (cardanoNativeUnitsEquivalent(x.unit, target)) {
          try {
            total += BigInt(String(x.quantity));
          } catch {
            /* ignore */
          }
        }
      }
    }
  }
  return total;
}

/** Blockfrost `GET /addresses/{addr}/utxos` item (Yaci Store compatible). */
type BfAddressUtxo = {
  tx_hash: string;
  output_index: number;
  address: string;
  amount: Array<{ unit: string; quantity: string | number }>;
  data_hash?: string | null;
  inline_datum?: string | null;
  reference_script_hash?: string | null;
};

function bfAddressUtxoToMeshUtxo(item: BfAddressUtxo): UTxO {
  return {
    input: {
      outputIndex: item.output_index,
      txHash: item.tx_hash,
    },
    output: {
      address: item.address,
      amount: item.amount.map((a) => ({ unit: a.unit, quantity: String(a.quantity) })),
      dataHash: item.data_hash ?? undefined,
      plutusData: item.inline_datum ?? undefined,
      /** Skip Mesh `resolveScriptRef` — discovery only needs inline datum + amounts. */
      scriptRef: undefined,
      scriptHash: item.reference_script_hash ?? undefined,
    },
  };
}

/**
 * Paginated Blockfrost `GET /addresses/{addr}/utxos` (same base as Mesh `YaciProvider`).
 * Mesh `fetchAddressUTxOs` returns `[]` on **any** mapping error (e.g. one UTxO with a bad script ref),
 * which hides other valid lock outputs at the bridge script.
 */
export async function fetchAddressUtxosBlockfrostDirect(
  blockfrostApiBase: string,
  bech32: string,
): Promise<UTxO[]> {
  const base = blockfrostApiBase.trim().replace(/\/+$/u, '');
  const enc = encodeURIComponent(bech32.trim());
  const out: UTxO[] = [];
  for (let page = 1; page < 10_000; page++) {
    const r = await fetch(`${base}/addresses/${enc}/utxos?page=${page}`, yaciFetchInit);
    if (!r.ok) {
      const detail = await readYaciErrorBody(r);
      throw new Error(`Yaci Store UTxOs: HTTP ${r.status}${detail ? ` — ${detail}` : ''}`);
    }
    const j = (await r.json()) as unknown;
    if (!Array.isArray(j)) throw new Error('Yaci Store: unexpected UTxO response');
    if (j.length === 0) break;
    for (const raw of j as BfAddressUtxo[]) {
      try {
        out.push(bfAddressUtxoToMeshUtxo(raw));
      } catch {
        /* ignore malformed row; do not drop the whole page */
      }
    }
  }
  return out;
}

/**
 * Blockfrost `GET /txs/{hash}/utxos` — maps `outputs` the same way as address UTxOs.
 * Use when Mesh `fetchUTxOs` fails or returns empty due to a single bad output in `Promise.all`.
 */
export async function fetchTxUtxosBlockfrostDirect(
  blockfrostApiBase: string,
  txHash: string,
): Promise<UTxO[]> {
  const base = blockfrostApiBase.trim().replace(/\/+$/u, '');
  const h = txHash.replace(/^0x/i, '').trim().toLowerCase();
  const r = await fetch(`${base}/txs/${h}/utxos`, yaciFetchInit);
  if (!r.ok) {
    const detail = await readYaciErrorBody(r);
    throw new Error(`Yaci Store tx UTxOs: HTTP ${r.status}${detail ? ` — ${detail}` : ''}`);
  }
  const data = (await r.json()) as { outputs?: BfAddressUtxo[] };
  const outputs = data.outputs ?? [];
  const out: UTxO[] = [];
  for (const raw of outputs) {
    try {
      out.push(bfAddressUtxoToMeshUtxo(raw));
    } catch {
      /* skip */
    }
  }
  return out;
}

export function formatNativeUnits(amount: bigint, decimals: number): string {
  if (decimals < 0 || decimals > 18) return amount.toString();
  const d = BigInt(10) ** BigInt(decimals);
  const whole = amount / d;
  const frac = amount % d;
  if (frac === 0n) return whole.toString();
  const fracStr = frac.toString().padStart(decimals, '0').replace(/0+$/u, '');
  const s = `${whole.toString()}.${fracStr}`;
  const n = Number(s);
  if (!Number.isFinite(n)) return s;
  if (n >= 1_000_000) return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 6 });
}

function formatAdaFromLovelace(lovelace: bigint): string {
  if (lovelace === 0n) return '0';
  const whole = lovelace / 1_000_000n;
  const frac = lovelace % 1_000_000n;
  let s: string;
  if (frac === 0n) {
    s = whole.toString();
  } else {
    const fracStr = frac.toString().padStart(6, '0').replace(/0+$/u, '');
    s = `${whole.toString()}.${fracStr}`;
  }
  const n = Number(s);
  if (!Number.isFinite(n)) return s;
  if (n >= 1_000_000) return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 6 });
}
