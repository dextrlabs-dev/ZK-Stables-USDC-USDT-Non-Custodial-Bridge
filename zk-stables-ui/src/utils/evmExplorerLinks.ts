import type { Address } from 'viem';

/**
 * Public block explorer URLs for known chains. Local Hardhat/Anvil (31337) has no canonical explorer URL.
 */
export function evmTxExplorerUrl(chainId: number, txHash: string): string | null {
  const h = txHash.startsWith('0x') ? txHash : `0x${txHash}`;
  if (chainId === 31337) return null;
  if (chainId === 11155111) return `https://sepolia.etherscan.io/tx/${h}`;
  if (chainId === 1) return `https://etherscan.io/tx/${h}`;
  return null;
}

export function evmAddressExplorerUrl(chainId: number, address: Address): string | null {
  if (chainId === 31337) return null;
  if (chainId === 11155111) return `https://sepolia.etherscan.io/address/${address}`;
  if (chainId === 1) return `https://etherscan.io/address/${address}`;
  return null;
}
