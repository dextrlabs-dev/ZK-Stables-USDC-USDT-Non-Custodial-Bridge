import { createPublicClient, http, type PublicClient } from 'viem';
import { foundry } from 'viem/chains';
import { config } from '../config.js';
import type { GasMeasurement } from '../types.js';

let _client: PublicClient | null = null;

function getClient(): PublicClient {
  if (!_client) {
    _client = createPublicClient({
      chain: { ...foundry, id: 31337 },
      transport: http(config.evmRpcUrl),
    });
  }
  return _client;
}

export async function measureGas(operation: string, txHash: `0x${string}`): Promise<GasMeasurement> {
  const client = getClient();
  const receipt = await client.getTransactionReceipt({ hash: txHash });
  const tx = await client.getTransaction({ hash: txHash });

  const gasUsed = receipt.gasUsed;
  const effectiveGasPrice = receipt.effectiveGasPrice ?? tx.gasPrice ?? 0n;
  const gasCostWei = gasUsed * effectiveGasPrice;

  return { operation, txHash, gasUsed, effectiveGasPrice, gasCostWei };
}

export function extractEvmTxHashes(destinationHint: string | undefined): `0x${string}`[] {
  if (!destinationHint) return [];
  const matches = destinationHint.match(/0x[0-9a-fA-F]{64}/g) || [];
  return matches as `0x${string}`[];
}
