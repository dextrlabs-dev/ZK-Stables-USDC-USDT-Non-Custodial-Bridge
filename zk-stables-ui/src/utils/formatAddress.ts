/**
 * Display-friendly shortening for EVM, Cardano bech32, and Midnight mn_* addresses.
 */
export function shortenAddress(addr: string | null | undefined, opts?: { head?: number; tail?: number }): string {
  if (addr == null || typeof addr !== 'string') return '—';
  const t = addr.trim();
  if (!t) return '—';
  const head = opts?.head;
  const tail = opts?.tail;
  if (t.startsWith('0x') && t.length > 12) {
    const h = head ?? 6;
    const tl = tail ?? 4;
    return `${t.slice(0, h)}…${t.slice(-tl)}`;
  }
  if ((t.startsWith('addr1') || t.startsWith('addr_test1')) && t.length > 28) {
    const h = head ?? 16;
    const tl = tail ?? 10;
    return `${t.slice(0, h)}…${t.slice(-tl)}`;
  }
  if (t.startsWith('mn_') && t.length > 32) {
    const h = head ?? 18;
    const tl = tail ?? 12;
    return `${t.slice(0, h)}…${t.slice(-tl)}`;
  }
  if (t.length > 24) {
    const h = head ?? 10;
    const tl = tail ?? 8;
    return `${t.slice(0, h)}…${t.slice(-tl)}`;
  }
  return t;
}
