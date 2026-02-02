/**
 * Frozen cross-chain event schema used across relayer, SDK, and on-chain adapters.
 *
 * This file is intentionally narrow: it defines the canonical data model that must be
 * encoded into source-chain events and proven by ZK circuits.
 */

export type ChainKind = 'evm' | 'cardano' | 'midnight';

export type AssetKind = 'USDC' | 'USDT';

/**
 * Canonical 32-byte nonce.
 * - EVM: derived from on-chain nonce counters or keccak256(commitment).
 * - Cardano: derived from tx hash + index or explicit datum nonce.
 * - Midnight: may be a commitment (hash of nonce preimage).
 */
export type Nonce32Hex = `0x${string}`;

/**
 * Canonical commitment to the lock/burn intent used by ZK circuits.
 * This is the stable, chain-agnostic message that will be proven to exist in a finalized block.
 */
export type BridgeIntentCommitment = {
  asset: AssetKind;
  amount: string;
  recipient: string;
  sourceChain: ChainKind;
  destinationChain: string;
  nonce: Nonce32Hex;
};

export type SourceLockEvent = {
  kind: 'Lock';
  chain: ChainKind;
  txId: string;
  blockId?: string;
  commitment: BridgeIntentCommitment;
};

export type DestinationBurnEvent = {
  kind: 'Burn';
  chain: ChainKind;
  txId: string;
  blockId?: string;
  commitment: BridgeIntentCommitment;
};

export type BridgeEvent = SourceLockEvent | DestinationBurnEvent;

