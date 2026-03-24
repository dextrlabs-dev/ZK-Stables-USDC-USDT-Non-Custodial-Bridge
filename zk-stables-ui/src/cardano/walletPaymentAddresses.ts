import { deserializeAddress } from '@meshsdk/core';
import type { BridgeSigningWalletHandle } from './resolveBridgeSigningWallet.js';

function normalizePaymentKeyHash(vkh: string): string {
  return vkh.replace(/^0x/i, '').trim().toLowerCase();
}

/**
 * Payment key hashes for all used + unused addresses from a Mesh wallet (mnemonic demo in this UI).
 * Bridge lock datums key recipients by payment vkh; wallets may use a non-first address.
 */
export async function walletPaymentKeyHashSet(wallet: BridgeSigningWalletHandle): Promise<Set<string>> {
  const used = await wallet.getUsedAddresses();
  let unused: string[] = [];
  try {
    unused = await wallet.getUnusedAddresses();
  } catch {
    /* wallet may not implement */
  }
  const set = new Set<string>();
  for (const raw of [...used, ...unused]) {
    const a = raw?.trim();
    if (!a) continue;
    try {
      set.add(normalizePaymentKeyHash(deserializeAddress(a).pubKeyHash));
    } catch {
      continue;
    }
  }
  return set;
}

/** First bech32 in the wallet whose payment vkh matches (hex, any case). */
export async function findWalletBech32ForPaymentKeyHash(
  wallet: BridgeSigningWalletHandle,
  recipientVkeyHashHex56: string,
): Promise<string | undefined> {
  const want = normalizePaymentKeyHash(recipientVkeyHashHex56);
  const used = await wallet.getUsedAddresses();
  let unused: string[] = [];
  try {
    unused = await wallet.getUnusedAddresses();
  } catch {
    unused = [];
  }
  for (const raw of [...used, ...unused]) {
    const a = raw?.trim();
    if (!a) continue;
    try {
      if (normalizePaymentKeyHash(deserializeAddress(a).pubKeyHash) === want) return a;
    } catch {
      continue;
    }
  }
  return undefined;
}
