import { createPublicClient, formatEther, formatUnits, http, type Address } from 'viem';
import { localhost } from 'viem/chains';

const erc20BalanceAbi = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
] as const;

export type AnvilBalanceRow = {
  address: Address;
  ethFormatted: string;
  usdc?: string;
  usdt?: string;
  /** ZkStablesWrappedToken balances (bridge-minted on EVM). */
  wusdc?: string;
  wusdt?: string;
};

/**
 * Read native ETH and optional MockERC20 balances for Anvil demo accounts (no wallet connection required).
 */
export async function fetchAnvilDemoBalances(params: {
  rpcUrl: string;
  accounts: readonly Address[];
  usdc?: Address;
  usdt?: Address;
  /** Wrapped USDC / USDT (`ZkStablesWrappedToken`) — set from `deploy-anvil.js` → `wUSDC` / `wUSDT`. */
  wusdc?: Address;
  wusdt?: Address;
  tokenDecimals?: number;
}): Promise<AnvilBalanceRow[]> {
  const client = createPublicClient({
    chain: localhost,
    transport: http(params.rpcUrl),
  });
  const dec = params.tokenDecimals ?? 6;
  const out: AnvilBalanceRow[] = [];

  for (const address of params.accounts) {
    const wei = await client.getBalance({ address });
    const ethStr = formatEther(wei);
    const row: AnvilBalanceRow = {
      address,
      ethFormatted: Number(ethStr) >= 1000 ? `${ethStr.slice(0, 10)}…` : ethStr,
    };

    if (params.usdc) {
      const raw = await client.readContract({
        address: params.usdc,
        abi: erc20BalanceAbi,
        functionName: 'balanceOf',
        args: [address],
      });
      row.usdc = formatUnits(raw, dec);
    }
    if (params.usdt) {
      const raw = await client.readContract({
        address: params.usdt,
        abi: erc20BalanceAbi,
        functionName: 'balanceOf',
        args: [address],
      });
      row.usdt = formatUnits(raw, dec);
    }
    if (params.wusdc) {
      const raw = await client.readContract({
        address: params.wusdc,
        abi: erc20BalanceAbi,
        functionName: 'balanceOf',
        args: [address],
      });
      row.wusdc = formatUnits(raw, dec);
    }
    if (params.wusdt) {
      const raw = await client.readContract({
        address: params.wusdt,
        abi: erc20BalanceAbi,
        functionName: 'balanceOf',
        args: [address],
      });
      row.wusdt = formatUnits(raw, dec);
    }
    out.push(row);
  }

  return out;
}

/** Single-account bridged (wrapped) token balances for the account bar. */
export async function fetchBridgedWrappedBalances(params: {
  rpcUrl: string;
  account: Address;
  wusdc?: Address;
  wusdt?: Address;
  tokenDecimals?: number;
}): Promise<{ wusdc?: string; wusdt?: string }> {
  const rows = await fetchAnvilDemoBalances({
    rpcUrl: params.rpcUrl,
    accounts: [params.account],
    wusdc: params.wusdc,
    wusdt: params.wusdt,
    tokenDecimals: params.tokenDecimals,
  });
  const r = rows[0];
  if (!r) return {};
  return { wusdc: r.wusdc, wusdt: r.wusdt };
}
