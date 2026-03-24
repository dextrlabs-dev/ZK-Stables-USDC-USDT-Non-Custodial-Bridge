/** Lowercase hex, no 0x. */
export function normalizeCardanoUnitHex(unit: string): string {
  return unit.replace(/^0x/i, '').trim().toLowerCase();
}

function hexToBytes(hex: string): Uint8Array | null {
  const h = normalizeCardanoUnitHex(hex);
  if (h.length % 2 !== 0) return null;
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) {
    const b = Number.parseInt(h.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(b)) return null;
    out[i] = b;
  }
  return out;
}

/** Leading/trailing 0x00 bytes (API / env padding differences). */
function trimAssetNamePadding(bytes: Uint8Array): Uint8Array {
  let start = 0;
  let end = bytes.length;
  while (start < end && bytes[start] === 0) start++;
  while (end > start && bytes[end - 1] === 0) end--;
  return bytes.slice(start, end);
}

function splitPolicyAndName(fullUnit: string): { policy: string; nameHex: string } | null {
  const u = normalizeCardanoUnitHex(fullUnit);
  if (u.length < 56) return null;
  return { policy: u.slice(0, 56), nameHex: u.slice(56) };
}

/**
 * Same Cardano native asset as `policyIdHex (56) + assetNameHex`, ignoring common hex padding
 * on the asset name (wallets vs `.env` often disagree on leading/trailing null bytes).
 */
export function cardanoNativeUnitsEquivalent(a: string, b: string): boolean {
  const na = normalizeCardanoUnitHex(a);
  const nb = normalizeCardanoUnitHex(b);
  if (na === nb) return true;
  const pa = splitPolicyAndName(na);
  const pb = splitPolicyAndName(nb);
  if (!pa || !pb) return false;
  if (pa.policy !== pb.policy) return false;
  const ba = hexToBytes(pa.nameHex);
  const bb = hexToBytes(pb.nameHex);
  if (!ba || !bb) return pa.nameHex === pb.nameHex;
  const ta = trimAssetNamePadding(ba);
  const tb = trimAssetNamePadding(bb);
  if (ta.length !== tb.length) return false;
  return ta.every((v, i) => v === tb[i]);
}
