# What is ZK-Stables?

ZK-Stables is a non-custodial, privacy-preserving cross-chain bridge for stablecoins. It enables USDC and USDT movement across three blockchain ecosystems -- EVM, Cardano, and Midnight -- using zero-knowledge proofs and on-chain script enforcement to guarantee that no central operator ever takes custody of user funds.

## The Problem

Moving stablecoins between blockchains today typically requires trusting a custodian -- a centralized entity that holds your assets on one chain and issues IOUs on another. This introduces counterparty risk, censorship vectors, and opacity around how funds are actually managed.

Cross-chain bridges have historically been among the most exploited pieces of DeFi infrastructure. Users need:

- **Non-custodial guarantees** -- funds should be locked in verifiable smart contracts, not held in operator wallets.
- **Privacy** -- bridge transactions should not expose user balances, identities, or transaction graphs to the public.
- **Proof-based finality** -- destination minting should only occur after cryptographic verification of the source-chain event, not after an operator "says so."

## The Solution

ZK-Stables addresses these requirements through a multi-chain architecture that combines:

- **Midnight Compact contracts** for zero-knowledge proof generation and shielded state management. The ZK circuits (`proveHolder`, mint/burn paths) ensure privacy at the protocol level.
- **EVM Solidity contracts** for pool locking (`ZkStablesPoolLock`), verified bridge minting (`ZkStablesBridgeMint`), and wrapped token issuance (`ZkStablesWrappedToken`).
- **Cardano Aiken validators** for lock/release logic with replay protection and inline datum verification (`lock_pool`, `unlock_pool`).
- **A relayer service** that orchestrates cross-chain communication -- detecting events on one chain, constructing proofs, and submitting transactions on another.

## Supported Chains

| Chain | Role | Technology |
|-------|------|------------|
| **EVM** (Ethereum / Anvil devnet) | Source-of-funds rail; pool lock/unlock and wrapped token contracts | Solidity, Hardhat |
| **Cardano** (Preprod / Yaci DevKit) | Lock/release rail with native asset minting under forge policy | Aiken validators, Mesh SDK |
| **Midnight** | Privacy rail with shielded/unshielded ledger state via ZK circuits | Compact language, ZK proof server |

## Bridged Assets

| Source Asset | Bridged Representation | Description |
|-------------|----------------------|-------------|
| USDC (or mock mUSDC) | **zkUSDC** | Verified bridge issuance -- minted only after on-chain proof verification |
| USDT (or mock mUSDT) | **zkUSDT** | Verified bridge issuance -- minted only after on-chain proof verification |

The "zk" prefix denotes that these tokens exist **only after validation**, not as traditional same-chain wrapped assets. No destination mint occurs without passing verification.

## Bridge Lifecycle

ZK-Stables operates through two primary flows:

### LOCK (Deposit and Mint)

1. **User locks** stablecoins (USDC/USDT) on the source chain (e.g., EVM `ZkStablesPoolLock`).
2. **Relayer detects** the lock event and waits for sufficient block confirmations (finality).
3. **Proof construction** -- the relayer builds a proof bundle (Merkle inclusion for EVM, stub-SHA256 for Cardano, ZK circuits for Midnight).
4. **Destination mint** -- after on-chain verification passes, zkUSDC/zkUSDT is minted to the recipient on the destination chain.

### BURN (Redeem and Unlock)

1. **User burns** the wrapped asset (zkUSDC/zkUSDT) on the destination chain.
2. **Relayer detects** the burn event with its associated `burnCommitmentHex`.
3. **Proof construction** -- the relayer proves the burn occurred on the source chain.
4. **Source unlock** -- the original USDC/USDT is unlocked and released to the user on the source chain.

## Non-Custodial Guarantees

ZK-Stables is designed so that user funds are never held by operators:

- **Funds are locked in smart contracts**, not in operator-controlled wallets. On EVM, `ZkStablesPoolLock` holds locked assets. On Cardano, the `lock_pool` Aiken validator controls UTxOs.
- **Minting requires on-chain verification.** The `ZkStablesBridgeMint` contract calls `verifier.verify` before any tokens are issued. Midnight runs Compact circuits. Cardano spends follow validator rules.
- **Replay protection** is enforced at every layer -- nonce tracking on EVM, datum-level uniqueness on Cardano, and per-ticket deployment or registry maps on Midnight.
- **The relayer is an automation layer**, not a custodian. It detects events, constructs proofs, and submits transactions, but it cannot mint without passing verification or unlock without valid proof.

## Current Status

ZK-Stables is a **research prototype** intended for architectural validation and integration testing on local/devnet stacks. It is not production-ready and has not undergone a full security audit. See [Prototype Status](prototype-status.md) for details on what is implemented and what limitations exist.
