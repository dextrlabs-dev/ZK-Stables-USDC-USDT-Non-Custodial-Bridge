import { config } from '../config.js';
import type { CardanoCost } from '../types.js';

export async function measureCardanoCost(operation: string, txHash: string): Promise<CardanoCost | null> {
  if (!config.yaciUrl) return null;

  try {
    const url = `${config.yaciUrl}/api/v1/txs/${txHash}`;
    const resp = await fetch(url);
    if (!resp.ok) return null;

    const data = await resp.json() as Record<string, unknown>;
    const redeemers = (data as { redeemers?: Array<{ mem?: number; steps?: number }> }).redeemers;
    if (!redeemers || redeemers.length === 0) return null;

    let totalMem = 0;
    let totalSteps = 0;
    for (const r of redeemers) {
      totalMem += r.mem ?? 0;
      totalSteps += r.steps ?? 0;
    }

    return { operation, txHash, memoryUnits: totalMem, cpuSteps: totalSteps };
  } catch {
    return null;
  }
}
