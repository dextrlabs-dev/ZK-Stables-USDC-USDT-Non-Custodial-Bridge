/** Truncate long hex strings for UI (e.g. payment key hashes). */
export function shortenHexAddr(hex: string, head = 12, tail = 8): string {
  if (hex.length <= head + tail) return hex;
  return `${hex.slice(0, head)}…${hex.slice(-tail)}`;
}
