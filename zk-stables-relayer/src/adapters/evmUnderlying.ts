import type { Address } from 'viem';

/**
 * Resolve mock/mainnet underlying ERC20 for pool `unlock` / `unlockWithInclusionProof`.
 * USDT prefers `RELAYER_EVM_UNDERLYING_TOKEN_USDT`, then falls back to `RELAYER_EVM_UNDERLYING_TOKEN`.
 */
export function resolveUnderlyingTokenForAsset(asset: 'USDC' | 'USDT'): Address | undefined {
  const primary = process.env.RELAYER_EVM_UNDERLYING_TOKEN?.trim();
  const usdt = process.env.RELAYER_EVM_UNDERLYING_TOKEN_USDT?.trim();
  const pick = (v: string | undefined): Address | undefined =>
    v?.startsWith('0x') && v.length === 42 ? (v as Address) : undefined;
  if (asset === 'USDT') return pick(usdt) ?? pick(primary);
  return pick(primary);
}
