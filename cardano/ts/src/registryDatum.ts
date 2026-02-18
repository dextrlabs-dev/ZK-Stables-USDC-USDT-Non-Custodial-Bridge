import { deserializeDatum } from '@meshsdk/core';

function bytesFromEntry(x: unknown): string | null {
  if (typeof x === 'string') return x;
  if (x && typeof x === 'object' && 'bytes' in x && typeof (x as { bytes: unknown }).bytes === 'string') {
    return (x as { bytes: string }).bytes;
  }
  return null;
}

/** Best-effort parse of `RegistryDatum` used_nonces list from datum CBOR. */
export function parseUsedNoncesFromDatumCbor(plutusDataCborHex: string): string[] {
  const j = deserializeDatum(plutusDataCborHex) as unknown;
  if (!j || typeof j !== 'object') return [];

  const o = j as { fields?: unknown[]; list?: unknown[] };

  let list: unknown[] | undefined;
  if (Array.isArray(o.fields) && o.fields.length > 0) {
    const first = o.fields[0] as { list?: unknown[] };
    list = first?.list;
  } else if (Array.isArray(o.list)) {
    list = o.list;
  }

  if (!list) return [];
  const out: string[] = [];
  for (const item of list) {
    const b = bytesFromEntry(item);
    if (b) out.push(b);
  }
  return out;
}
