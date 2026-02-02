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
