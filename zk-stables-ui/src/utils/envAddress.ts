import { getAddress, isAddress, type Address } from 'viem';

/** Parse Vite `import.meta.env` address strings (trim, strip quotes, checksum). */
export function parseEnvEthereumAddress(raw: string | undefined): Address | undefined {
  const t = String(raw ?? '')
    .trim()
    .replace(/^["']|["']$/g, '');
  if (!t || !isAddress(t)) return undefined;
  try {
    return getAddress(t);
  } catch {
    return undefined;
  }
}
