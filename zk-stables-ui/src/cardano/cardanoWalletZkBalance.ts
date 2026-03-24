import { cardanoNativeUnitsEquivalent } from './cardanoNativeUnitMatch.js';
import { resolveBridgeSigningWallet } from './resolveBridgeSigningWallet.js';

/** Sum native token quantity for `unit` across the wallet's UTxO set (Mesh mnemonic demo wallet). */
export async function sumWalletNativeUnitBalance(opts: {
  cip30WalletKey: string;
  useDemoMnemonicWallet?: boolean;
  /** Full native unit: policyIdHex (56) + assetNameHex, lowercase. */
  unit: string;
}): Promise<bigint> {
  const target = opts.unit.replace(/^0x/i, '').trim().toLowerCase();
  if (!target) return 0n;
  const wallet = await resolveBridgeSigningWallet({
    cip30WalletKey: opts.cip30WalletKey,
    useDemoMnemonicWallet: Boolean(opts.useDemoMnemonicWallet),
  });
  const utxos = await wallet.getUtxos();
  let sum = 0n;
  for (const u of utxos) {
    for (const a of u.output.amount) {
      if (cardanoNativeUnitsEquivalent(a.unit, target)) {
        try {
          sum += BigInt(String(a.quantity));
        } catch {
          /* ignore bad quantity */
        }
      }
    }
  }
  return sum;
}
