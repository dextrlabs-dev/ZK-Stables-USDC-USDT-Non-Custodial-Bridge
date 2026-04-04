export type Stable = 'USDC' | 'USDT';

export function assetKind(asset: Stable): number {
  return asset === 'USDT' ? 1 : 0;
}

export function zkLabel(asset: Stable): string {
  return asset === 'USDT' ? 'zkUSDT' : 'zkUSDC';
}
