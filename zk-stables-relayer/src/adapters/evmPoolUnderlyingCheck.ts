import { createPublicClient, http } from 'viem';
import { foundry } from 'viem/chains';
import type { Address } from 'viem';

const erc20BalanceOfAbi = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
] as const;

/**
 * MockERC20 (and ZkStablesWrappedToken) revert with reason `"balance"` when `transfer` would exceed
 * the sender balance. The pool must hold enough underlying before `unlock` / `unlockWithInclusionProof`.
 */
export async function assertPoolUnderlyingSufficient(params: {
  rpcUrl: string;
  poolLock: Address;
  underlyingToken: Address;
  amount: bigint;
}): Promise<void> {
  const pub = createPublicClient({ chain: foundry, transport: http(params.rpcUrl) });
  const bal = await pub.readContract({
    address: params.underlyingToken,
    abi: erc20BalanceOfAbi,
    functionName: 'balanceOf',
    args: [params.poolLock],
  });
  if (bal < params.amount) {
    throw new Error(
      `Insufficient underlying in ZkStablesPoolLock for this unlock: token=${params.underlyingToken} pool=${params.poolLock} balance=${bal} required=${params.amount}. ` +
        `Deposit at least that amount via pool lock() first (same underlying token as RELAYER_EVM_UNDERLYING_TOKEN), or lower the redeem amount.`,
    );
  }
}
