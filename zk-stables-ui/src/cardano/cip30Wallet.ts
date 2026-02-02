export type Cip30WalletApi = {
  getNetworkId(): Promise<number>;
  getUsedAddresses(): Promise<string[]>;
  getBalance(): Promise<string>;
};

export type InjectedCardanoWallet = {
  name?: string;
  icon?: string;
  enable?: () => Promise<Cip30WalletApi>;
  isEnabled?: () => Promise<boolean>;
};

export function listCardanoWalletKeys(): string[] {
  const c = (typeof window !== 'undefined' && window.cardano) || {};
  return Object.keys(c).filter((k) => {
    const w = c[k as keyof typeof c] as InjectedCardanoWallet | undefined;
    return w && typeof w.enable === 'function';
  });
}

export async function connectCip30Wallet(key: string): Promise<{ usedAddressesHex: string[]; networkId: number }> {
  const w = window.cardano?.[key as keyof typeof window.cardano] as InjectedCardanoWallet | undefined;
  if (!w?.enable) {
    throw new Error(`Cardano wallet "${key}" not found or has no enable().`);
  }
  const api = await w.enable();
  const [networkId, used] = await Promise.all([api.getNetworkId(), api.getUsedAddresses()]);
  return { usedAddressesHex: used, networkId };
}

export function shortenHexAddr(hex: string, head = 12, tail = 8): string {
  if (hex.length <= head + tail) return hex;
  return `${hex.slice(0, head)}…${hex.slice(-tail)}`;
}
