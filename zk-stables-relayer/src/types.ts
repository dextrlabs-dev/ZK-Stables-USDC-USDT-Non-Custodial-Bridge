/** Matches zk-stables-ui CrossChainIntentPanel payload + relayer metadata. */

import type { MerkleInclusionProofV1 } from './zk/evmInclusion.js';

export type SourceChain = 'evm' | 'cardano' | 'midnight';

export type Operation = 'LOCK' | 'BURN';

export type LockIntent = {
  operation: 'LOCK';
  sourceChain: SourceChain;
  destinationChain?: string;
  asset: 'USDC' | 'USDT';
  assetKind: number;
  amount: string;
  recipient: string;
  /**
   * Optional source anchor (Phase 2+): points at the exact on-chain event
   * that must be proven and replay-protected.
   */
  source?: {
    evm?: {
      txHash: `0x${string}`;
      logIndex: number;
      blockNumber?: string;
      poolLockAddress?: `0x${string}`;
      token?: `0x${string}`;
      nonce?: `0x${string}`;
    };
  };
  connected?: {
    evm?: string;
    cardano?: string;
    midnight?: string;
  };
  note?: string;
};

export type BurnIntent = {
  operation: 'BURN';
  sourceChain: SourceChain;
  destinationChain?: string;
  asset: 'USDC' | 'USDT';
  assetKind: number;
  amount: string;
  /**
   * Recipient on the source chain that should receive unlocked funds.
   * (Matches SRS burn→unlock flow semantics.)
   */
  recipient: string;
  source?: {
    evm?: {
      txHash: `0x${string}`;
      logIndex: number;
      blockNumber?: string;
      wrappedTokenAddress?: `0x${string}`;
      nonce?: `0x${string}`;
    };
  };
  note?: string;
};

export type BridgeIntent = LockIntent | BurnIntent;

export type RelayerPhase =
  | 'received'
  | 'awaiting_finality'
  | 'proving'
  | 'destination_handoff'
  | 'completed'
  | 'failed';

export type RelayerJob = {
  id: string;
  intent: BridgeIntent;
  phase: RelayerPhase;
  createdAt: string;
  updatedAt: string;
  error?: string;
  /** Synthetic lock id until on-chain events are wired. */
  lockRef: string;
  /** merkle-inclusion-v1 = chain-data Merkle proof; stub-sha256-v1 = dev digest only. */
  proofBundle?: {
    algorithm: string;
    digest: string;
    publicInputsHex: string;
    inclusion?: MerkleInclusionProofV1;
  };
  /** What the destination should do next (Midnight mint, EVM mint, etc.). */
  destinationHint?: string;
};
