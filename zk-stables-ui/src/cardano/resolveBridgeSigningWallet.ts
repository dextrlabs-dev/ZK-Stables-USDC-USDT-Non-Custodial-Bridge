import type { MeshWallet } from '@meshsdk/core';
import { createDemoMnemonicMeshWallet, isDemoCardanoMnemonicConfigured } from './demoMnemonicMeshWallet.js';

/** In-app `MeshWallet` from `VITE_DEMO_CARDANO_WALLET_MNEMONIC` (browser extension signing removed from this UI). */
export type BridgeSigningWalletHandle = MeshWallet;

export async function resolveBridgeSigningWallet(opts: {
  /** Must be `'demo'` (in-app mode). */
  cip30WalletKey: string;
  useDemoMnemonicWallet: boolean;
}): Promise<BridgeSigningWalletHandle> {
  if (opts.useDemoMnemonicWallet && opts.cip30WalletKey === 'demo' && isDemoCardanoMnemonicConfigured()) {
    return createDemoMnemonicMeshWallet();
  }
  throw new Error(
    'Set VITE_DEMO_CARDANO_WALLET_MNEMONIC (same phrase as RELAYER_CARDANO_WALLET_MNEMONIC), rebuild the UI, then reload.',
  );
}
