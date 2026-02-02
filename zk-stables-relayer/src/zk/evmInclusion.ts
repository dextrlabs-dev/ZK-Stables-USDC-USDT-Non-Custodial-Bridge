import { MerkleTree } from 'merkletreejs';
import keccak256 from 'keccak256';
import { createPublicClient, http, type Address, type Hex, type Log } from 'viem';
import { foundry } from 'viem/chains';
import { hashLogLeafV1 } from './evmLogMerkle.js';

export type MerkleInclusionProofV1 = {
  algorithm: 'merkle-inclusion-v1';
  chainId: number;
  blockHash: Hex;
  blockNumber: bigint;
  txHash: Hex;
  merkleRoot: Hex;
  leaf: Hex;
  leafIndex: number;
  proof: Hex[];
  /** Raw log fields for on-chain recomputation */
  logIndex: bigint;
  emitter: Address;
  topics: Hex[];
  data: Hex;
};

function logToLeaf(log: Log): Hex {
  if (log.logIndex == null) throw new Error('log.logIndex required');
  const t0 = log.topics[0]!;
  const t1 = log.topics[1];
  const t2 = log.topics[2];
  const t3 = log.topics[3];
  return hashLogLeafV1({
    logIndex: BigInt(log.logIndex),
    emitter: log.address,
    topic0: t0,
    topic1: t1,
    topic2: t2,
    topic3: t3,
    data: log.data,
  });
}

export async function buildMerkleInclusionProof(params: {
  rpcUrl: string;
  txHash: Hex;
  logIndex: bigint;
}): Promise<MerkleInclusionProofV1> {
  const client = createPublicClient({ chain: foundry, transport: http(params.rpcUrl) });
  const receipt = await client.getTransactionReceipt({ hash: params.txHash });
  if (!receipt) throw new Error('receipt not found');
  const logs = receipt.logs;
  const leaves = logs.map((l) => Buffer.from(logToLeaf(l).slice(2), 'hex'));
  const tree = new MerkleTree(leaves, keccak256, { sortPairs: true, hashLeaves: false });
  const root = (`0x${tree.getRoot().toString('hex')}`) as Hex;
  const idx = logs.findIndex((l) => {
    if (l.logIndex == null) return false;
    return BigInt(l.logIndex) === params.logIndex;
  });
  if (idx < 0) throw new Error('logIndex not in receipt');
  const leafHex = logToLeaf(logs[idx]!);
  const leafBuf = Buffer.from(leafHex.slice(2), 'hex');
  const proof = tree.getProof(leafBuf).map((p) => (`0x${p.data.toString('hex')}`) as Hex);
  const log = logs[idx]!;
  if (log.logIndex == null) throw new Error('logIndex missing');
  return {
    algorithm: 'merkle-inclusion-v1',
    chainId: client.chain?.id ?? 31337,
    blockHash: receipt.blockHash,
    blockNumber: receipt.blockNumber,
    txHash: params.txHash,
    merkleRoot: root,
    leaf: leafHex,
    leafIndex: idx,
    proof,
    logIndex: BigInt(log.logIndex),
    emitter: log.address,
    topics: log.topics as Hex[],
    data: log.data,
  };
}
