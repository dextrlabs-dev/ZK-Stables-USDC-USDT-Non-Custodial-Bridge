import { createPublicClient, createWalletClient, http } from 'viem';
import { foundry } from 'viem/chains';
import type { Address, Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { assertPoolUnderlyingSufficient } from './evmPoolUnderlyingCheck.js';

const poolAbi = [
  {
    type: 'function',
    name: 'unlock',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'recipient', type: 'address' },
      { name: 'burnNonce', type: 'bytes32' },
    ],
    outputs: [],
  },
] as const;

/**
 * Operator-only `ZkStablesPoolLock.unlock` — used when zk was burned on Cardano/Midnight and the user
 * claims underlying USDC/USDT on EVM (no Merkle proof; stub / demo parity with cross-chain burn binding).
 * `burnNonce` must match a fresh slot; we use the 32-byte `burnCommitmentHex` from the intent.
 */
export async function evmPoolUnlockOperator(params: {
  rpcUrl: string;
  privateKey: Hex;
  poolLock: Address;
  underlyingToken: Address;
  recipient: Address;
  amount: bigint;
  /** 32-byte value, typically `burnCommitmentHex` from the off-chain burn anchor. */
  burnCommitment: Hex;
}): Promise<{ txHash: Hex }> {
  await assertPoolUnderlyingSufficient({
    rpcUrl: params.rpcUrl,
    poolLock: params.poolLock,
    underlyingToken: params.underlyingToken,
    amount: params.amount,
  });
  const account = privateKeyToAccount(params.privateKey);
  const client = createWalletClient({ chain: foundry, transport: http(params.rpcUrl), account });

  const txHash = await client.writeContract({
    address: params.poolLock,
    abi: poolAbi,
    functionName: 'unlock',
    args: [params.underlyingToken, params.amount, params.recipient, params.burnCommitment],
  });
  const pub = createPublicClient({ chain: foundry, transport: http(params.rpcUrl) });
  await pub.waitForTransactionReceipt({ hash: txHash });
  return { txHash };
}
