import { createPublicClient, createWalletClient, http } from 'viem';
import { foundry } from 'viem/chains';
import type { Address, Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import type { MerkleInclusionProofV1 } from '../zk/evmInclusion.js';

const poolAbi = [
  {
    type: 'function',
    name: 'unlockWithInclusionProof',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'recipient', type: 'address' },
      { name: 'wrappedEmitter', type: 'address' },
      { name: 'logBlockNumber', type: 'uint256' },
      { name: 'blockHash', type: 'bytes32' },
      { name: 'merkleRoot', type: 'bytes32' },
      { name: 'merkleProof', type: 'bytes32[]' },
      { name: 'leaf', type: 'bytes32' },
      { name: 'logIndex', type: 'uint256' },
      { name: 'topic0', type: 'bytes32' },
      { name: 'topic1', type: 'bytes32' },
      { name: 'topic2', type: 'bytes32' },
      { name: 'topic3', type: 'bytes32' },
      { name: 'logData', type: 'bytes' },
    ],
    outputs: [],
  },
] as const;

export async function evmUnlockWithInclusionProof(params: {
  rpcUrl: string;
  privateKey: Hex;
  poolLock: Address;
  underlyingToken: Address;
  recipient: Address;
  amount: bigint;
  wrappedEmitter: Address;
  proof: MerkleInclusionProofV1;
}): Promise<{ txHash: Hex }> {
  const account = privateKeyToAccount(params.privateKey);
  const client = createWalletClient({ chain: foundry, transport: http(params.rpcUrl), account });
  const t = params.proof.topics;
  const topic0 = t[0]!;
  const topic1 = t[1] ?? ('0x' + '00'.repeat(32)) as Hex;
  const topic2 = t[2] ?? ('0x' + '00'.repeat(32)) as Hex;
  const topic3 = t[3] ?? ('0x' + '00'.repeat(32)) as Hex;

  const txHash = await client.writeContract({
    address: params.poolLock,
    abi: poolAbi,
    functionName: 'unlockWithInclusionProof',
    args: [
      params.underlyingToken,
      params.amount,
      params.recipient,
      params.wrappedEmitter,
      params.proof.blockNumber,
      params.proof.blockHash,
      params.proof.merkleRoot,
      params.proof.proof as readonly Hex[],
      params.proof.leaf,
      params.proof.logIndex,
      topic0,
      topic1,
      topic2,
      topic3,
      params.proof.data,
    ],
  });
  const pub = createPublicClient({ chain: foundry, transport: http(params.rpcUrl) });
  await pub.waitForTransactionReceipt({ hash: txHash });
  return { txHash };
}
