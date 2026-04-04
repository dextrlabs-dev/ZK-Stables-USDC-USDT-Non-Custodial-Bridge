/** Parse a decimal string (e.g. stablecoin UI amount) into integer token units. */
/** Stablecoin-style display: integer units → decimal string (no scientific notation). */
export function formatTokenUnitsToDecimal(units: bigint, decimals: number): string {
  const neg = units < 0n;
  const x = neg ? -units : units;
  const base = 10n ** BigInt(decimals);
  const whole = x / base;
  const frac = x % base;
  if (frac === 0n) return (neg ? '-' : '') + whole.toString();
  let fs = frac.toString().padStart(decimals, '0');
  fs = fs.replace(/0+$/u, '');
  return (neg ? '-' : '') + `${whole}.${fs}`;
}

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

const DIGITS_ONLY = /^\d+$/u;

/**
 * Normalize relayer intent `amount` strings to raw token units.
 * Watchers emit digit-only strings (on-chain quantities). HTTP/UI intents use decimal human amounts (e.g. "11948.7").
 */
export function intentAmountToTokenUnits(
  amountStr: string,
  opts: {
    operation: 'LOCK' | 'BURN';
    sourceChain: 'evm' | 'cardano' | 'midnight';
    /** True when this BURN was ingested from an EVM `Burned` log (`amount` is already raw units). */
    evmBurnFromChainLog?: boolean;
  },
): bigint {
  const decimals = Number(process.env.RELAYER_EVM_TOKEN_DECIMALS ?? process.env.RELAYER_CARDANO_ASSET_DECIMALS ?? 6);
  const s = amountStr.trim().replace(/,/g, '');
  if (!s) throw new Error('empty amount');
  if (opts.operation === 'BURN' && opts.sourceChain === 'evm' && opts.evmBurnFromChainLog && DIGITS_ONLY.test(s)) {
    return BigInt(s);
  }
  if (opts.operation === 'LOCK' && opts.sourceChain === 'cardano' && DIGITS_ONLY.test(s)) {
    return BigInt(s);
  }
  return parseDecimalAmountToUnits(s, decimals);
}
