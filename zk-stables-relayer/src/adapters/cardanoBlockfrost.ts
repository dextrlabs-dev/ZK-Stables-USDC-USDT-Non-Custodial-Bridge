/** Cardano Preprod / Mainnet health via Blockfrost (no key in repo — use env). */

const PREPROD_BASE = 'https://cardano-preprod.blockfrost.io/api/v0';
const MAINNET_BASE = 'https://cardano-mainnet.blockfrost.io/api/v0';

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
  const base = network === 'mainnet' ? MAINNET_BASE : PREPROD_BASE;
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
