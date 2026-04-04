/** 32-byte commitment / tx id as 64 lowercase hex (no 0x). */
export function normHex64(h: string): string {
  const x = h.replace(/^0x/i, '').trim().toLowerCase();
  if (x.length !== 64 || !/^[0-9a-f]+$/u.test(x)) {
    throw new Error('Expected exactly 64 hex characters (32 bytes), optional 0x prefix.');
  }
  return x;
}

export function is0xTx64(h: string): boolean {
  return /^0x[0-9a-fA-F]{64}$/u.test(h.trim());
}
