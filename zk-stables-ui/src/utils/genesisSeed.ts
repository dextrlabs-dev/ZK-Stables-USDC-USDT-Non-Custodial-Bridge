import { uint8ArrayToHex } from './hex.js';

function isHex64(s: string): boolean {
  return /^[0-9a-fA-F]{64}$/.test(s);
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  const buf = bytes.slice().buffer as ArrayBuffer;
  const d = await crypto.subtle.digest('SHA-256', buf);
  return new Uint8Array(d);
}

/**
 * Accepts either:
 * - 64-hex (already a hash), or
 * - an arbitrary string (hashed to 32 bytes)
 */
export async function normalizeGenesisSeedHashHex(input: string): Promise<string> {
  const s = input.trim().replace(/^0x/, '');
  if (!s) throw new Error('genesis seed required');
  if (isHex64(s)) return s.toLowerCase();
  const h = await sha256(new TextEncoder().encode(s));
  return uint8ArrayToHex(h);
}

/** Deterministically derive a bytes32 hex from the seed-hash + a label. */
export async function deriveBytes32HexFromGenesis(params: {
  genesisSeedHashHex: string;
  label: string;
}): Promise<string> {
  const seed = params.genesisSeedHashHex.trim().replace(/^0x/, '').toLowerCase();
  if (!isHex64(seed)) throw new Error('genesisSeedHashHex must be 64 hex');
  const payload = `${params.label}:${seed}`;
  const h = await sha256(new TextEncoder().encode(payload));
  return uint8ArrayToHex(h);
}

