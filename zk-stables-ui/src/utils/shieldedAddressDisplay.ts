import { MidnightBech32m } from '@midnight-ntwrk/wallet-sdk-address-format';

/**
 * ShieldedAddress from wallet-sdk-shielded does not implement a useful `toString()`.
 * Encode to mn_* bech32m for display (same shape as unshielded mn_addr_*).
 */
export function formatShieldedAddressForDisplay(networkId: string, addr: unknown): string | null {
  if (addr == null) return null;
  if (typeof addr === 'string') return addr;
  if (typeof addr !== 'object') return String(addr);
  try {
    return MidnightBech32m.encode(networkId, addr as any).asString();
  } catch {
    const o = addr as { coinPublicKeyString?: () => string; encryptionPublicKeyString?: () => string };
    if (typeof o.coinPublicKeyString === 'function' && typeof o.encryptionPublicKeyString === 'function') {
      return `${o.coinPublicKeyString()}:${o.encryptionPublicKeyString()}`;
    }
    return null;
  }
}
