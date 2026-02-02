import { createPublicClient, http } from 'viem';

/** Optional RPC checks for ops dashboard (not required for intent pipeline). */
export async function evmRpcOk(
  rpcUrl?: string,
): Promise<{ ok: boolean; chainId?: number; blockNumber?: bigint; error?: string }> {
  if (!rpcUrl) return { ok: false, error: 'no RPC' };
  try {
    const client = createPublicClient({ transport: http(rpcUrl) });
    const [id, blockNumber] = await Promise.all([client.getChainId(), client.getBlockNumber()]);
    return { ok: true, chainId: id, blockNumber };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function midnightIndexerPing(url: string): Promise<{ ok: boolean; status?: number; error?: string }> {
  try {
    // Some local indexers return a *relative* 308 location which undici fetch may not follow reliably.
    const u0 = new URL(url);
    const doReq = async (u: URL) =>
      fetch(u, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: '{ __typename }' }),
        redirect: 'manual',
      });

    const r0 = await doReq(u0);
    if (r0.status >= 200 && r0.status < 300) return { ok: true, status: r0.status };
    if (r0.status >= 300 && r0.status < 400) {
      const loc = r0.headers.get('location');
      if (!loc) return { ok: true, status: r0.status };
      const u1 = new URL(loc, u0);
      const r1 = await doReq(u1);
      return { ok: r1.status >= 200 && r1.status < 400, status: r1.status };
    }
    return { ok: false, status: r0.status };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
