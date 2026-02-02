# Bridge proof binding (Phase 4)

The SRS/architecture require that cross-chain mint/unlock actions are triggered only after a proof of:
- **finalized header**
- **event inclusion**
- **nonce replay protection**

This repo’s Midnight contract (`contract/src/zk-stables.compact`) currently stores:
- `depositCommitment : Bytes<32>` — intended to bind a bridge ticket to a source-chain lock
- `sourceChainId : Uint<32>`
- `amount : Uint<64>`
- `assetKind : AssetKind`

## Binding rule (reference)

For Phase 4, the binding between a source-chain lock and a Midnight bridge ticket is:

- **Source intent commitment** (canonical, chain-agnostic):
  - `commitment = H(assetKind, amount, recipient, sourceChainId, destChainId, nonce32)`

- **Deposit commitment**:
  - `depositCommitment = H("zkstables:deposit:v1", commitment)`

`depositCommitment` is then persisted in Midnight and used to derive wrapped token domains (`wrappedTokenDomain()`), ensuring that wrapped assets are bound to the original source lock commitment.

## Current implementation status

- The relayer currently produces a **stub digest** (`stub-sha256-v1`) and does not yet produce SNARK public inputs.
- The UI/CLI can deploy and operate the Midnight contract; the bridge proof binding is documented here so the off-chain encoder and future circuits can align.

## Next steps

1. Update the off-chain encoding notes (`DEPOSIT_COMMITMENT_ENCODING.md`) to match this binding once the hash function and field packing are finalized.
2. Replace the stub proof pipeline with real circuits and expose `publicInputsHash` consistently across EVM/Cardano/Midnight.

