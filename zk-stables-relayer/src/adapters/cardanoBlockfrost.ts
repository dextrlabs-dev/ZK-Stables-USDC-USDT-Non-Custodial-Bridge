/** Cardano Preprod / Mainnet health via Blockfrost (no key in repo — use env). */

const PREPROD_BASE = 'https://cardano-preprod.blockfrost.io/api/v0';
const MAINNET_BASE = 'https://cardano-mainnet.blockfrost.io/api/v0';

function baseFor(network: 'preprod' | 'mainnet'): string {
  return network === 'mainnet' ? MAINNET_BASE : PREPROD_BASE;
}

export type BlockfrostHealth = {
  ok: boolean;
  network: 'preprod' | 'mainnet';
  latestBlockHeight?: number;
  error?: string;
};

export async function blockfrostLatestBlock(
  projectId: string,
  network: 'preprod' | 'mainnet' = 'preprod',
): Promise<BlockfrostHealth> {
  const base = baseFor(network);
  try {
    const r = await fetch(`${base}/blocks/latest`, {
      headers: { project_id: projectId },
    });
    if (!r.ok) {
      return {
        ok: false,
        network,
        error: `HTTP ${r.status} ${await r.text()}`,
      };
    }
    const j = (await r.json()) as { height?: number };
    return { ok: true, network, latestBlockHeight: j.height };
  } catch (e) {
    return {
      ok: false,
      network,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export type BlockfrostAmount = { unit: string; quantity: string };

export type BlockfrostUtxo = {
  tx_hash: string;
  output_index: number;
  amount: BlockfrostAmount[];
  block?: string;
  data_hash?: string | null;
  inline_datum?: string | null;
  reference_script_hash?: string | null;
};

export async function blockfrostAddressUtxos(
  projectId: string,
  network: 'preprod' | 'mainnet',
  address: string,
): Promise<BlockfrostUtxo[]> {
  const base = baseFor(network);
  const r = await fetch(`${base}/addresses/${encodeURIComponent(address)}/utxos`, {
    headers: { project_id: projectId },
  });
  if (!r.ok) {
    throw new Error(`blockfrostAddressUtxos: HTTP ${r.status} ${await r.text()}`);
  }
  return (await r.json()) as BlockfrostUtxo[];
}

export type BlockfrostTx = {
  block_height?: number;
  block?: string;
  hash: string;
};

export async function blockfrostTx(
  projectId: string,
  network: 'preprod' | 'mainnet',
  txHash: string,
): Promise<BlockfrostTx> {
  const base = baseFor(network);
  const r = await fetch(`${base}/txs/${encodeURIComponent(txHash)}`, {
    headers: { project_id: projectId },
  });
  if (!r.ok) {
    throw new Error(`blockfrostTx: HTTP ${r.status} ${await r.text()}`);
  }
  return (await r.json()) as BlockfrostTx;
}

/** Split Blockfrost `unit` into policy id (56 hex) and asset name hex tail (may be empty). */
export function splitBlockfrostUnit(unit: string): { policyIdHex: string; assetNameHex: string } {
  if (unit === 'lovelace') {
    return { policyIdHex: '', assetNameHex: '' };
  }
  if (unit.length < 56) {
    return { policyIdHex: unit, assetNameHex: '' };
  }
  return {
    policyIdHex: unit.slice(0, 56),
    assetNameHex: unit.slice(56) || '',
  };
}

/** First native token unit excluding lovelace, if any. */
export function primaryFungibleUnit(amounts: BlockfrostAmount[]): BlockfrostAmount | undefined {
  return amounts.find((a) => a.unit !== 'lovelace');
}
