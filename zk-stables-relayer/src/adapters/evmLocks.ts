import { createPublicClient, http, parseAbiItem } from 'viem';
import type { Address, Hex } from 'viem';
import { foundry } from 'viem/chains';

export type EvmLockEvent = {
  txHash: Hex;
  logIndex: number;
  blockNumber: bigint;
  token: Address;
  sender: Address;
  recipient: Address;
  amount: bigint;
  nonce: Hex;
};

const lockedEvent = parseAbiItem(
  'event Locked(address indexed token,address indexed sender,address indexed recipient,uint256 amount,bytes32 nonce)',
);

export async function fetchLockEvents(params: {
  rpcUrl: string;
  poolLockAddress: Address;
  fromBlock: bigint;
  toBlock: bigint;
}): Promise<EvmLockEvent[]> {
  const client = createPublicClient({ chain: foundry, transport: http(params.rpcUrl) });
  const logs = await client.getLogs({
    address: params.poolLockAddress,
    event: lockedEvent,
    fromBlock: params.fromBlock,
    toBlock: params.toBlock,
  });
  return logs.map((l) => ({
    txHash: l.transactionHash!,
    logIndex: Number(l.logIndex),
    blockNumber: l.blockNumber!,
    token: l.args.token as Address,
    sender: l.args.sender as Address,
    recipient: l.args.recipient as Address,
    amount: l.args.amount as bigint,
    nonce: l.args.nonce as Hex,
  }));
}

