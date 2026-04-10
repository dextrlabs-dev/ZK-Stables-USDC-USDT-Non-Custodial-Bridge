/** Accepts `0x` + 40 hex or bare 40 hex; returns lowercase `0x…` or empty. */
export function normalizeEvmPayoutAddr(raw: string): `0x${string}` | '' {
  const t = raw.trim();
  if (!t) return '';
  const with0x = /^0x/i.test(t) ? t : `0x${t}`;
  const lc = with0x.toLowerCase();
  return /^0x[0-9a-f]{40}$/u.test(lc) ? (lc as `0x${string}`) : '';
}
