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

const YACI_PROBE_TIMEOUT_MS = 4000;

/** Single cheap request to see if Yaci Store (or the Vite proxy to it) is up. Avoids hammering `/addresses/.../utxos` when the backend is down. */
export async function isYaciStoreReachable(yaciStoreBaseUrl: string): Promise<boolean> {
  const base = yaciStoreBaseUrl.trim().replace(/\/+$/u, '');
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), YACI_PROBE_TIMEOUT_MS);
  try {
    const r = await fetch(`${base}/blocks/latest`, { signal: ac.signal });
    return r.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
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
    const r = await fetch(`${base}/addresses/${enc}/utxos?page=${page}`);
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
  let total = 0n;

  for (let page = 1; page < 10_000; page++) {
    const r = await fetch(`${base}/addresses/${enc}/utxos?page=${page}`);
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
      const a = u.amount?.find((x) => x.unit === unit);
      if (a) total += BigInt(a.quantity);
    }
  }
  return total;
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
