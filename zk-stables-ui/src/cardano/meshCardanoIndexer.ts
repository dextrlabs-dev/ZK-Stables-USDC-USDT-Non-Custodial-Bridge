import { BlockfrostProvider, YaciProvider } from '@meshsdk/core';
import type { IEvaluator, IFetcher, ISubmitter } from '@meshsdk/common';

export type CardanoIndexer = IFetcher & ISubmitter & IEvaluator;

/**
 * Blockfrost-compatible Yaci API base for Mesh (queries + submit). Prefer `VITE_YACI_URL`; if unset,
 * derive from `VITE_YACI_STORE_URL` (e.g. `/yaci-store` → same-origin proxy to `:8080/api/v1`).
 */
export function resolveBrowserYaciMeshApiBase(): string | null {
  const direct = String(import.meta.env.VITE_YACI_URL ?? '').trim();
  if (direct) return direct.replace(/\/+$/u, '');
  const store = String(import.meta.env.VITE_YACI_STORE_URL ?? '').trim();
  if (store.startsWith('/') && typeof window !== 'undefined') {
    return `${window.location.origin}${store}`.replace(/\/+$/u, '');
  }
  if (store.startsWith('http')) return store.replace(/\/+$/u, '');
  return null;
}

/** Browser-side UTxO fetcher: match relayer env names with `VITE_` prefix. */
export function createBrowserCardanoIndexer(): CardanoIndexer {
  const yaci = resolveBrowserYaciMeshApiBase();
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
