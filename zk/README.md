# Proofs: Merkle inclusion (implemented) vs optional ZK SNARKs

## FR-3.1.2 (EVM): finality + Merkle / event inclusion

The relayer now produces **`merkle-inclusion-v1`** bundles for anchored EVM logs:

- **Finality**: waits `RELAYER_EVM_CONFIRMATIONS` blocks after the log’s block (`zk-stables-relayer/src/adapters/evmFinality.ts`).
- **Inclusion**: builds a **sorted-pair Merkle tree** over all logs in the transaction (same algorithm as OpenZeppelin `MerkleProof` + `merkletreejs` tests in `evm/test/merkle-match.test.js`).
- **On-chain verification**: `ZkStablesPoolLock.unlockWithInclusionProof` recomputes the leaf with `LogLeaf.sol`, checks `MerkleProof.verify`, and checks `blockhash(blockNumber) == blockHash` (EVM limitation: `blockhash` is only reliable for the last **256** blocks).

Implementation:

- `zk-stables-relayer/src/zk/evmInclusion.ts`
- `zk-stables-relayer/src/zk/evmLogMerkle.ts`
- `evm/contracts/MerkleProof.sol`, `evm/contracts/LogLeaf.sol`, `evm/contracts/ZkStablesPoolLock.sol`

## “Real ZK” in the SRS sense (SNARK / STARK)

A **succinct ZK proof** (hiding witnesses, recursive composition, etc.) is **not** yet generated here. The next step is to wrap the same **public inputs** (`blockHash`, `merkleRoot`, `leaf`, burn/lock semantics) in a **circom/arkworks** circuit and verify with a pairing-based verifier contract.

Stub / demo verifiers:

- `evm/contracts/BridgeVerifierMock.sol` (mint path)
- `zk-stables-relayer/src/zk/stubProof.ts` (only when no on-chain log anchor is present)
