export type YaciHealth = {
  ok: boolean;
  latestBlockHeight?: number;
  error?: string;
};

export type YaciUtxo = {
  tx_hash: string;
  output_index: number;
  amount: Array<{ unit: string; quantity: string }>;
  data_hash?: string | null;
  inline_datum?: string | null;
  reference_script_hash?: string | null;
  script_ref?: string | null;
  address?: string;
  block_number?: number;
  block_time?: number;
  epoch?: number;
};

export type YaciTx = {
  hash: string;
  block_height?: number;
};

export function normalizeYaciBaseUrl(raw: string): string {
  const base = raw.trim().replace(/\/+$/u, '');
  if (base === '') throw new Error('Empty Yaci base URL');
  return base;
}

export async function yaciLatestBlock(baseUrl: string): Promise<YaciHealth> {
  const base = normalizeYaciBaseUrl(baseUrl);
  try {
    const r = await fetch(`${base}/blocks/latest`);
    if (!r.ok) {
      return { ok: false, error: `HTTP ${r.status} ${await r.text()}` };
    }
    const j = (await r.json()) as { height?: number; number?: number };
    const h = j.height ?? j.number;
    return { ok: true, latestBlockHeight: h };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function yaciAddressUtxos(baseUrl: string, address: string): Promise<YaciUtxo[]> {
  const base = normalizeYaciBaseUrl(baseUrl);
  const enc = encodeURIComponent(address);
  const out: YaciUtxo[] = [];
  for (let page = 1; page < 10_000; page++) {
    const r = await fetch(`${base}/addresses/${enc}/utxos?page=${page}`);
    if (!r.ok) {
      throw new Error(`yaciAddressUtxos: HTTP ${r.status} ${await r.text()}`);
    }
    const j = (await r.json()) as unknown;
    if (!Array.isArray(j)) throw new Error('yaciAddressUtxos: unexpected response shape (expected array)');
    if (j.length === 0) break;
    out.push(...(j as YaciUtxo[]));
  }
  return out;
}

export async function yaciTx(baseUrl: string, txHash: string): Promise<YaciTx> {
  const base = normalizeYaciBaseUrl(baseUrl);
  const r = await fetch(`${base}/txs/${encodeURIComponent(txHash)}`);
  if (!r.ok) {
    throw new Error(`yaciTx: HTTP ${r.status} ${await r.text()}`);
  }
  const j = (await r.json()) as { hash?: string; block_height?: number };
  return { hash: j.hash ?? txHash, block_height: j.block_height };
}

