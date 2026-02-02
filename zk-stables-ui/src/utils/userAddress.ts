import * as ledger from '@midnight-ntwrk/ledger-v8';
import { MidnightBech32m, UnshieldedAddress } from '@midnight-ntwrk/wallet-sdk-address-format';
import { hexToUint8Array } from './hex.js';

const ADDR_HEX_LEN = 64;

/** Compact circuit expects `{ bytes: encodeUserAddress(userAddr) }`. */
export function userAddressStructFromInput(input: string, networkId: string): { bytes: Uint8Array } {
  const trimmed = input.trim();
  if (!trimmed) throw new Error('empty address');

  if (/^mn_addr_/i.test(trimmed) || trimmed.startsWith('mn_')) {
    const parsed = MidnightBech32m.parse(trimmed);
    const ua = parsed.decode(UnshieldedAddress, networkId);
    const userAddr: ledger.UserAddress = ua.hexString;
    return { bytes: ledger.encodeUserAddress(userAddr) };
  }

  const hex = trimmed.replace(/^0x/, '');
  if (hex.length === ADDR_HEX_LEN && /^[0-9a-fA-F]+$/.test(hex)) {
    const userAddr = hex as ledger.UserAddress;
    return { bytes: ledger.encodeUserAddress(userAddr) };
  }

  if (hex.length === ADDR_HEX_LEN / 2 && /^[0-9a-fA-F]+$/.test(hex)) {
    return { bytes: hexToUint8Array(hex) };
  }

  throw new Error('Expected mn_addr… bech32 or 32-byte hex UserAddress');
}
