import { createPublicClient, http } from 'viem';
import { foundry } from 'viem/chains';

/** Wait until `latestBlock - minedBlock >= confirmations` (FR-3.1.2 finality on EVM). */
export async function waitEvmConfirmations(params: {
  rpcUrl: string;
  minedBlock: bigint;
  confirmations: bigint;
}): Promise<void> {
  const client = createPublicClient({ chain: foundry, transport: http(params.rpcUrl) });
  const need = params.minedBlock + params.confirmations;
  for (;;) {
    const tip = await client.getBlockNumber();
    if (tip >= need) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
}
