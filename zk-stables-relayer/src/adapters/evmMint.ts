import { createWalletClient, http } from 'viem';
import { foundry } from 'viem/chains';
import type { Address, Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const bridgeMintAbi = [
  {
    type: 'function',
    name: 'mintWrapped',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'wrappedToken', type: 'address' },
      { name: 'recipient', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'nonce', type: 'bytes32' },
      { name: 'proof', type: 'bytes' },
      { name: 'publicInputsHash', type: 'bytes32' },
    ],
    outputs: [],
  },
] as const;

export async function evmMintWrapped(params: {
  rpcUrl: string;
  privateKey: Hex;
  bridgeMint: Address;
  wrappedToken: Address;
  recipient: Address;
  amount: bigint;
  nonce: Hex;
  proofBytes: Hex;
  publicInputsHash: Hex;
}): Promise<{ txHash: Hex }> {
  const account = privateKeyToAccount(params.privateKey);
  const client = createWalletClient({ chain: foundry, transport: http(params.rpcUrl), account });
  const txHash = await client.writeContract({
    address: params.bridgeMint,
    abi: bridgeMintAbi,
    functionName: 'mintWrapped',
    args: [
      params.wrappedToken,
      params.recipient,
      params.amount,
      params.nonce,
      params.proofBytes,
      params.publicInputsHash,
    ],
  });
  return { txHash };
}

