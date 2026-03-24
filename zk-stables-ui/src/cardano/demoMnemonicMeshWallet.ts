import { MeshWallet } from '@meshsdk/core';
import { createBrowserCardanoIndexer } from './meshCardanoIndexer.js';

/**
 * Same phrase as `RELAYER_CARDANO_WALLET_MNEMONIC` for in-app signing (dev or production).
 * Vite inlines the value into the client bundle — treat the deployed app like a hot wallet.
 */
export function parseDemoCardanoMnemonicWords(): string[] | null {
  const raw = String(import.meta.env.VITE_DEMO_CARDANO_WALLET_MNEMONIC ?? '').trim();
  if (!raw) return null;
  const words = raw.split(/\s+/u).filter(Boolean);
  if (words.length < 12) return null;
  return words;
}

export function isDemoCardanoMnemonicConfigured(): boolean {
  return parseDemoCardanoMnemonicWords() !== null;
}

/**
 * Mnemonic Mesh wallet for in-app signing when UI uses synthetic Cardano demo + env phrase.
 */
export async function createDemoMnemonicMeshWallet(): Promise<MeshWallet> {
  const words = parseDemoCardanoMnemonicWords();
  if (!words) {
    throw new Error(
      'Set VITE_DEMO_CARDANO_WALLET_MNEMONIC (same phrase as RELAYER_CARDANO_WALLET_MNEMONIC) for in-app lock/release.',
    );
  }
  const fetcher = createBrowserCardanoIndexer();
  const networkId = Number(import.meta.env.VITE_CARDANO_NETWORK_ID ?? '0') === 1 ? 1 : 0;
  return new MeshWallet({
    networkId: networkId as 0 | 1,
    fetcher,
    submitter: fetcher,
    key: { type: 'mnemonic', words },
  });
}
