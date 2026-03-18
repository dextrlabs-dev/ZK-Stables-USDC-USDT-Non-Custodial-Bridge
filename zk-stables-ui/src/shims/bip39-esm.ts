/**
 * Mesh imports `bip39` with named ESM; bitcoinjs `bip39` is CJS. A path import of `bip39/src`
 * can inline bare `exports` into the TLA-wrapped vendor chunk → ReferenceError in preview.
 * @scure/bip39 is native ESM and matches the same algorithms; we adapt the bitcoinjs call shape.
 */
import { entropyToMnemonic, mnemonicToEntropy as scureMnemonicToEntropy } from '@scure/bip39';
import { wordlist as englishWordlist } from '@scure/bip39/wordlists/english.js';
import { randomBytes } from '@noble/hashes/utils';
import { Buffer } from 'buffer';

export function generateMnemonic(
  strength = 128,
  rng?: (size: number) => Buffer,
  wordlist: string[] = englishWordlist,
): string {
  const rnd = rng ?? ((size: number) => Buffer.from(randomBytes(size)));
  const buf = rnd(strength / 8);
  const ent = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  return entropyToMnemonic(ent, wordlist);
}

export function mnemonicToEntropy(mnemonic: string, wordlist?: string[]): string {
  const wl = wordlist ?? englishWordlist;
  const u8 = scureMnemonicToEntropy(mnemonic, wl);
  return Buffer.from(u8).toString('hex');
}
