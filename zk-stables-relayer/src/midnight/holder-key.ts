import { CompactTypeBytes, CompactTypeVector, persistentHash, convertFieldToBytes } from '@midnight-ntwrk/compact-runtime';

/**
 * Pad a UTF-8 string into a fixed 32-byte Uint8Array (NUL-padded on the right).
 * Matches the byte-literal encoding Compact uses for string constants in circuits.
 */
function pad32Utf8(s: string): Uint8Array {
  const b = new TextEncoder().encode(s);
  const o = new Uint8Array(32);
  o.set(b.slice(0, 32));
  return o;
}

/**
 * Derive the holder ledger public key that the **zk-stables-registry** contract
 * expects in `registerDeposit(... holderPk)` and verifies in `proveHolder(dep)`.
 *
 * Must exactly match `_publicKeyHolderAt_0` in the compiled contract:
 *   persistentHash<Vector<3, Bytes<32>>>([
 *     "zkstables:registry:holder:pk:\0\0\0",  // 32-byte label
 *     convertFieldToBytes(32, round),           // round from map[8][dep], initially 0
 *     sk                                        // holder secret key
 *   ])
 */
export function holderLedgerPublicKey(holderSk: Uint8Array, round: bigint = 0n): Uint8Array {
  if (holderSk.length !== 32) {
    throw new Error('holder secret must be 32 bytes');
  }
  const t = new CompactTypeVector(3, new CompactTypeBytes(32));
  const roundBytes = convertFieldToBytes(32, round, 'holderLedgerPublicKey:round');
  return persistentHash(t, [
    pad32Utf8('zkstables:registry:holder:pk:'),
    roundBytes,
    holderSk,
  ]);
}
