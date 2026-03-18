import { BrowserWallet } from '@meshsdk/core';

/** Sum native token quantity for `unit` across the wallet's UTxO set (CIP-30 via Mesh). */
export async function sumWalletNativeUnitBalance(opts: {
  cip30WalletKey: string;
  /** Full native unit: policyIdHex (56) + assetNameHex, lowercase. */
  unit: string;
}): Promise<bigint> {
  const unit = opts.unit.replace(/^0x/i, '').trim().toLowerCase();
  if (!unit) return 0n;
  const wallet = await BrowserWallet.enable(opts.cip30WalletKey);
  const utxos = await wallet.getUtxos();
  let sum = 0n;
  for (const u of utxos) {
    for (const a of u.output.amount) {
      if (a.unit.replace(/^0x/i, '').trim().toLowerCase() === unit) {
        try {
          sum += BigInt(a.quantity);
        } catch {
          /* ignore bad quantity */
        }
      }
    }
  }
  return sum;
}
