/** Parse a decimal string (e.g. stablecoin UI amount) into integer token units. */
export function parseDecimalAmountToUnits(amountStr: string, decimals: number): bigint {
  const s = amountStr.trim().replace(/,/g, '');
  if (!s) throw new Error('empty amount');
  const neg = s.startsWith('-');
  const rest = neg ? s.slice(1) : s;
  const m = rest.match(/^(\d*)(?:\.(\d*))?$/);
  if (!m) throw new Error(`invalid amount: ${amountStr}`);
  const whole = m[1] || '0';
  let frac = m[2] || '';
  if (frac.length > decimals) frac = frac.slice(0, decimals);
  frac = frac.padEnd(decimals, '0');
  const bi = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(frac || '0');
  return neg ? -bi : bi;
}
