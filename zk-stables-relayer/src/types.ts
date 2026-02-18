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
    /** Cardano lock UTxO anchor (see contract/docs/DEPOSIT_COMMITMENT_ENCODING.md). */
    cardano?: {
      txHash: string;
      outputIndex: number;
      blockHeight?: string;
      scriptHash?: string;
      /** Policy hex (28-byte policy id); omit or empty for ada-only locks per tooling. */
      policyIdHex?: string;
      /** Hex-encoded asset name bytes. */
      assetNameHex?: string;
      /** Decimal string of UInt64 lock nonce from on-chain datum (if known). */
      lockNonce?: string;
    };
  };
  connected?: {
    evm?: string;
    cardano?: string;
    /** Shielded (Zswap) bech32 when Lace/dev wallet exposes it. */
    midnight?: string;
    /** Unshielded (tNight) `mn_addr_*` when dev-seed or tooling exposes it — valid Midnight recipient, not EVM/Cardano. */
    midnightUnshielded?: string;
    /** Relayer env `RELAYER_BRIDGE_*` — operator EVM / Cardano payout wallets for bridge handoff. */
    relayerBridge?: {
      evmRecipient?: string;
      cardanoRecipient?: string;
      /** Default Midnight destination for Cardano lock watcher when stub unset; optional echo on intents. */
      midnightRecipient?: string;
    };
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
  /**
   * 32-byte hex (64 chars, optional `0x`) binding the burn to a Midnight deposit / ticket (`BURN_UNLOCK` preimage).
   * Emitted in `ZkStablesWrappedToken.Burned` and required for `depositCommitment` computation.
   */
  burnCommitmentHex: string;
  source?: {
    evm?: {
      txHash: `0x${string}`;
      logIndex: number;
      blockNumber?: string;
      wrappedTokenAddress?: `0x${string}`;
      nonce?: `0x${string}`;
      /** Burner address (`Burned` topic1) — required for EVM `event_commitment`. */
      fromAddress?: `0x${string}`;
    };
    cardano?: {
      txHash: string;
      outputIndex: number;
      blockHeight?: string;
      scriptHash?: string;
      policyIdHex?: string;
      assetNameHex?: string;
      lockNonce?: string;
    };
  };
  /** Optional echo of connected wallets (UI); recipient must still be a source-chain address, not Midnight. */
  connected?: LockIntent['connected'];
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
  /** When computable: SHA-256 `depositCommitment` for `BURN_UNLOCK` (see DEPOSIT_COMMITMENT_ENCODING.md). */
  depositCommitmentHex?: string;
};
