# ZK-Stables `depositCommitment` and `operation_type` (off-chain spec)

This document defines canonical inputs for the **32-byte** `depositCommitment` stored on Midnight and referenced by the non-Compact bridge SNARK (finality + event inclusion + replay semantics). All multi-byte values are **big-endian** unless noted.

## `operation_type` (bridge-wide ZK / relayer)

Used in the architectural blueprint as a public input to the **separate** finality/inclusion circuits (not evaluated inside Compact):

| Value | Name           | Meaning                                      |
|------:|----------------|----------------------------------------------|
|     0 | `LOCK_MINT`    | Source chain lock observed → mint path       |
|     1 | `BURN_UNLOCK`  | Destination burn observed → unlock path      |

Compact contracts only model **Midnight ledger state** after a mint; relayers must tag proofs consistently with this enum when driving Cardano/EVM verifiers.

## `depositCommitment` = `persistentHash` preimage (conceptual)

The on-chain commitment MUST equal the hash agreed by:

1. **Source-chain lock event** (or Midnight-origin equivalent).
2. **Relayer / SNARK** public inputs (`header_hash`, `nonce_commitment`, `destination_chain_id`, `operation_type`, …).

Recommended **normative** construction (SHA-256 or the curve hash used by your SNARK stack—keep **one** choice across chains):

```
domain = UTF-8 "ZKStables:Deposit:v1"
depositCommitment = H(
  domain ||
  uint32_be(operation_type) ||          // 0 = LOCK_MINT for mint→Midnight
  uint32_be(source_chain_id) ||
  uint32_be(destination_chain_id) ||
  uint256_be(amount_raw) ||             // integer smallest units (6 decimals for USDC/USDT)
  uint8(asset_code) ||                 // 0 = USDC, 1 = USDT
  uint64_be(lock_nonce) ||             // bridge nonce from SRS
  nonce_commitment ||                  // 32 bytes, H(nonce_secret) or protocol nonce
  event_commitment                     // 32 bytes, see below
)
```

- `H` is the chosen 32-byte hash.
- `||` is concatenation; lengths fixed so parsers are unambiguous.

### `event_commitment` (chain-specific inner hash)

**EVM (lock on bridge pool contract)**

```
event_commitment = H(
  "ZKStables:EVM:Lock:v1" ||
  uint32_be(evm_chain_id) ||
  address_20_bytes(contract) ||
  uint256_be(tx_log_index) ||
  bytes32(tx_hash) ||
  bytes32(topic0_or_payload_digest)   // lock event fingerprint
)
```

**Cardano (lock UTxO)**

```
event_commitment = H(
  "ZKStables:Cardano:Lock:v1" ||
  bytes32(policy_id || padding)       // 28-byte policy + 4 zero pad if needed
  bytes32(asset_name || padding)      // name bytes padded/truncated to 32
  bytes32(txid) ||
  uint32_be(output_index) ||
  uint64_be(lock_nonce)
)
```

(Adjust field widths to match your exact Cardano lock script datum; the important part is **freezing the serialization in code** and using the same bytes in the SNARK witness.)

**Midnight (if Midnight is source)**

```
event_commitment = H(
  "ZKStables:Midnight:Lock:v1" ||
  bytes32(midnight_tx_id) ||
  bytes32(contract_or_note_digest)
)
```

## Integration with Compact

- [`zk-stables.compact`](../src/zk-stables.compact) stores **`depositCommitment`** as `Bytes<32>` at deploy time; the **DApp must pass** the same bytes produced by this spec after off-chain verification.
- The Compact contract does **not** re-verify the SNARK; it anchors Midnight state to the commitment for **replay resistance at the ticket level** (one deployment = one ticket) or via the registry contract’s uniqueness map.

## References

- SRS / architecture PDFs in the repository root.
- Midnight selective disclosure: [explicit disclosure](https://docs.midnight.network/docs/compact/reference/explicit-disclosure).
