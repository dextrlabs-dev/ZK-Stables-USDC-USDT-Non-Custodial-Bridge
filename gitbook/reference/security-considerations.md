# Security Considerations

This page outlines the security posture, trust model, and known limitations of the ZK-Stables bridge prototype. **This project has not been audited and is not suitable for production deployment or mainnet custody.**

---

## Prototype limitations

ZK-Stables is a **research and integration prototype** for bridging stablecoins (USDC/USDT) across EVM, Cardano, and Midnight chains. It is intended for:

- Architectural validation of the three-chain bridge design
- Integration testing against local devnet stacks (Anvil, Yaci, Midnight local network)
- Demonstrating ZK-proof workflows with Midnight Compact contracts

It is **not** intended for:

- Production custody of real assets
- Mainnet deployment without a comprehensive security review
- Use under adversarial conditions

There is no warranty of economic safety, liveness, or correctness. Toolchain version mismatches (Compact CLI, Midnight node/indexer/proof-server, wallet SDKs) can produce subtle runtime failures.

---

## Trust model

### Relayer as trusted operator

The relayer is a **trusted operator** in this prototype. It holds private keys for EVM transactions, a Cardano wallet mnemonic, and Midnight wallet credentials. The relayer:

- Watches for on-chain lock events and processes them into bridge jobs
- Generates Merkle proofs (EVM) or stub digests (Cardano/Midnight)
- Submits mint, lock, and unlock transactions on destination chains
- Manages job lifecycle from `received` through `completed` or `failed`

In a production system, the relayer's role would need to be decentralized or secured with additional safeguards (multisig, threshold signatures, TEE enclaves, etc.).

### On-chain invariants

While the relayer is trusted for orchestration, on-chain scripts enforce basic invariants:

- **EVM contracts:** `ZkStablesPoolLock` requires Merkle proof verification for `unlockWithInclusionProof`. `ZkStablesBridgeMint` has access control for the bridge operator address.
- **Cardano validators:** The Aiken `lock_pool` validator enforces `LockDatum` structure (amount, nonce, recipient commitment, chain ids) and validates `BridgeRelease` redeemer authorization.
- **Midnight contracts:** Compact programs enforce ZK circuit constraints for `proveHolder` and `mintWrappedUnshielded`.

---

## EVM contract considerations

Based on [`evm/AUDIT.md`](https://github.com/dextrlabs-dev/ZK-Stables-USDC-USDT-Non-Custodial-Bridge/blob/main/evm/AUDIT.md), the EVM contracts are **reference implementations for local Anvil testing** and are not production-audited.

### Merkle proof verification

- `ZkStablesPoolLock.unlockWithInclusionProof` verifies OpenZeppelin-style Merkle proofs against transaction logs
- The `blockhash` opcode window is limited to the most recent 256 blocks; proofs referencing older blocks cannot be verified on-chain
- The relayer's `merkle-inclusion-v1` algorithm builds Merkle trees using `merkletreejs` with Solidity-compatible leaf hashing

### Access control

- `ZkStablesBridgeMint` restricts minting to the configured bridge operator address
- Owner functions on `ZkStablesPoolLock` (vault management, upgrades) are currently single-key; production requires multisig or governance

### Pre-mainnet EVM requirements

1. External security audit (no Critical/High findings per SRS)
2. Formal verification or exhaustive testing of Merkle + `blockhash` window (256 blocks)
3. Governance / multisig for `ZkStablesPoolLock` owner functions and vault upgrades

See [`evm/spec/security-nfr-checklist.md`](https://github.com/dextrlabs-dev/ZK-Stables-USDC-USDT-Non-Custodial-Bridge/blob/main/evm/spec/security-nfr-checklist.md) for the full NFR checklist.

---

## Cardano validator considerations

### Nonce replay prevention

- `LockDatum` includes a `lock_nonce` field to prevent replay of lock operations
- The `recipient_commitment` (SHA-256 of `lockRef:proofDigest`) binds each lock to a specific proof, preventing cross-job replay
- `source_chain_id` and `destination_chain_id` in `LockDatum` provide cross-chain binding

### Validator authorization

- `BridgeRelease` redeemer is authorized either by the bridge operator or by the intended recipient (when `RELAYER_CARDANO_DESTINATION_LOCK_HOLD` is set)
- The Aiken validator enforces that minted assets match the datum's declared amount and asset parameters
- Collateral is required for all Plutus script spends; the bridge wallet must maintain sufficient ADA

### Concurrency

- Cardano UTxO-based transactions are serialized via `cardanoBridgeMutex.ts` to prevent `BadInputsUTxO` / `ValueNotConservedUTxO` errors from overlapping UTxO selection

---

## Midnight privacy model

### ZK proofs

- **`proveHolder`**: Generates a zero-knowledge proof that the holder has a valid deposit commitment without revealing the underlying values
- **`mintWrappedUnshielded`**: Mints wrapped stablecoins on Midnight after proof verification

### Shielded vs unshielded

- Midnight supports both **shielded** (Zswap-based, private) and **unshielded** (public ledger) balances
- The current bridge prototype uses `mintWrappedUnshielded` for bridged assets, placing them on the public ledger
- Shielded transfers (`initiateBurn` with `recipientComm`) are supported for the burn/redeem path
- Full shielded minting would require additional Compact program support

### Private state

- Midnight wallet private state is stored in LevelDB (`RELAYER_MIDNIGHT_LEVEL_DB_PATH`)
- Concurrent access to LevelDB is serialized via `midnightPipelineMutex.ts`
- The `MIDNIGHT_LDB_PASSWORD` (16+ characters) encrypts the private state at rest; override the dev default in production

---

## Pre-mainnet requirements checklist

Before any mainnet deployment, the following must be completed:

| Requirement | Status | Notes |
|-------------|--------|-------|
| External security audit (EVM contracts) | Not started | No Critical/High findings required per SRS |
| External security audit (Cardano validators) | Not started | Aiken validator review |
| External security audit (Midnight contracts) | Not started | Compact program review |
| Formal verification of Merkle proof logic | Not started | `blockhash` window, proof construction |
| Multisig / governance for contract admin | Not started | Currently single-key operator |
| Key management (HSM / TEE for relayer keys) | Not started | Private keys currently in env vars |
| Rate limiting and DDoS protection | Not started | Relayer API is currently unprotected |
| Monitoring and alerting | Not started | Job failures, chain health |
| Incident response procedures | Not started | Bridge pause, emergency unlock |
| Insurance / risk framework | Not started | Economic safety guarantees |
| Production LevelDB encryption | Dev default | Override `MIDNIGHT_LDB_PASSWORD` |
| Persistent job storage | Not implemented | Jobs are in-memory only |

---

*This document reflects the prototype's security posture. It will be updated as security reviews are completed and production hardening progresses.*
