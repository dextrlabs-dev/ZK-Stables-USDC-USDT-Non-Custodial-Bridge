const yaciFetchInit: RequestInit = {
  cache: 'no-store',
  headers: {
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    Pragma: 'no-cache',
  },
};

function unitsMatch(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

type AmountRow = { unit: string; quantity: string };

async function readYaciErrorBody(r: Response): Promise<string> {
  try {
    const t = await r.text();
    return t.trim().slice(0, 400);
  } catch {
    return '';
  }
}

/** Paginated Blockfrost-compatible address UTxOs (Yaci Store or Blockfrost). */
export async function sumNativeAssetAtAddress(params: {
  apiBase: string;
  bech32Address: string;
  assetUnit: string;
  projectId?: string;
}): Promise<bigint> {
  const base = params.apiBase.trim().replace(/\/+$/u, '');
  const enc = encodeURIComponent(params.bech32Address.trim());
  const target = params.assetUnit.trim();
  if (!target) return 0n;

  const headers: Record<string, string> = {};
  if (params.projectId) {
    headers.project_id = params.projectId;
  }

  let total = 0n;
  for (let page = 1; page < 10_000; page++) {
    const r = await fetch(`${base}/addresses/${enc}/utxos?page=${page}`, {
      ...yaciFetchInit,
      headers: { ...yaciFetchInit.headers, ...headers },
    });
    if (!r.ok) {
      const detail = await readYaciErrorBody(r);
      throw new Error(`Cardano UTxOs HTTP ${r.status}${detail ? ` — ${detail}` : ''}`);
    }
    const j = (await r.json()) as unknown;
    if (!Array.isArray(j)) throw new Error('Cardano indexer: unexpected UTxO response');
    if (j.length === 0) break;
    for (const u of j as Array<{ amount?: AmountRow[] }>) {
      for (const x of u.amount ?? []) {
        if (unitsMatch(x.unit, target)) {
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
