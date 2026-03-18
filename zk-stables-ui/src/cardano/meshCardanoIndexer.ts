import { BlockfrostProvider, YaciProvider } from '@meshsdk/core';
import type { IEvaluator, IFetcher, ISubmitter } from '@meshsdk/common';

export type CardanoIndexer = IFetcher & ISubmitter & IEvaluator;

/** Browser-side UTxO fetcher: match relayer env names with `VITE_` prefix. */
export function createBrowserCardanoIndexer(): CardanoIndexer {
  const yaci = String(import.meta.env.VITE_YACI_URL ?? '').trim();
  const yaciAdmin = String(import.meta.env.VITE_YACI_ADMIN_URL ?? '').trim();
  const bf = String(import.meta.env.VITE_BLOCKFROST_PROJECT_ID ?? '').trim();
  if (yaci) {
    return new YaciProvider(yaci, yaciAdmin || undefined) as CardanoIndexer;
  }
  if (bf) {
    return new BlockfrostProvider(bf) as CardanoIndexer;
  }
  throw new Error('Set VITE_YACI_URL (and optional VITE_YACI_ADMIN_URL) or VITE_BLOCKFROST_PROJECT_ID for Cardano redeem.');
}
