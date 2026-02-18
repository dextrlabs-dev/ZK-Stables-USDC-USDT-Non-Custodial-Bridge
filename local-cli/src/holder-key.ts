import { CompactTypeBytes, CompactTypeVector, persistentHash } from '@midnight-ntwrk/compact-runtime';

function pad32Utf8(s: string): Uint8Array {
  const b = new TextEncoder().encode(s);
  const o = new Uint8Array(32);
  o.set(b.slice(0, 32));
  return o;
}

export function holderLedgerPublicKey(holderSk: Uint8Array): Uint8Array {
  if (holderSk.length !== 32) {
    throw new Error('holder secret must be 32 bytes');
  }
  const round0 = new Uint8Array(32);
  const t = new CompactTypeVector(3, new CompactTypeBytes(32));
  return persistentHash(t, [pad32Utf8('zkstables:holder:pk:'), round0, holderSk]);
}

/**
 * Must match `publicKeyHolderAt` in `zk-stables-registry.compact` (prefix + `depositRound` as 32 bytes + sk).
 * For a newly registered deposit, `depositRound` starts at 0 → use default 32 zero bytes (same as single-ticket round encoding).
 */
export function registryHolderLedgerPublicKey(
  holderSk: Uint8Array,
  depositRoundAsBytes32: Uint8Array = new Uint8Array(32),
): Uint8Array {
  if (holderSk.length !== 32) {
    throw new Error('holder secret must be 32 bytes');
  }
  if (depositRoundAsBytes32.length !== 32) {
    throw new Error('deposit round encoding must be 32 bytes');
  }
  const t = new CompactTypeVector(3, new CompactTypeBytes(32));
  return persistentHash(t, [pad32Utf8('zkstables:registry:holder:pk:'), depositRoundAsBytes32, holderSk]);
}
