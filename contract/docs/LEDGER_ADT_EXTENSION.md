# Ledger ADT usage (unshielded wrap + further extensions)

## Implemented: wrapped unshielded (Tier A / B)

[`zk-stables.compact`](../src/zk-stables.compact) and [`zk-stables-registry.compact`](../src/zk-stables-registry.compact) integrate the [token-transfers](https://docs.midnight.network/docs/examples/contracts/token-transfers) pattern:

- **`mintWrappedUnshielded`**: operator-only, `Active`, once per ticket — `mintUnshieldedToken` + contract as recipient (`kernel.self()`), domain = `persistentHash(pad("zkstables:wrap:USDC|USDT:v1"), depositCommitment)`.
- **`sendWrappedUnshieldedToUser`**: holder-only, `ExitPending`, sends ledger `amount` via `sendUnshielded`/`tokenType` to `user_addr`.
- **`finalizeBurn`**: requires prior release **if** a mint happened (`mintedUnshielded` / registry map); metadata-only tickets can still finalize without mint.

Shielded (`mintShieldedToken` / `sendShielded`) is **not** wired here yet.

## Optional: further unshielded / zswap hooks

You may still extend the same contracts with other ADT operations—for example **receiving** unshielded into the contract (`receiveUnshielded`), **native Night** (`default<Bytes<32>>`), or **shielded** paths—using [ledger data types](https://docs.midnight.network/docs/compact/data-types/ledger-adt) ([midnight-docs](https://github.com/midnightntwrk/midnight-docs)).

## Typical hooks (illustrative)

| Goal | ADT operations to study |
|------|-------------------------|
| Read contract unshielded balance | `balance`, `balanceGreaterThan` |
| Authorize unshielded outflow in same tx | `claimUnshieldedCoinSpend`, `incUnshieldedOutputs` |
| Coordinate with another contract call | `claimContractCall` |
| Shielded flow | `claimZswapCoinSpend`, `claimZswapCoinReceive`, `claimZswapNullifier` |

## Integration notes

1. **Keep cross-chain SNARK verification out of Compact** — finality and lock/burn inclusion proofs remain in the separate prover/verifier stack; Midnight circuits only enforce **local** authorization and state transitions.
2. Any new `claim*` or balance checks must be paired with **witness / disclosure** rules so private data is not leaked accidentally (see [explicit disclosure](https://docs.midnight.network/docs/compact/reference/explicit-disclosure)).
3. Prefer **small, audited changes**: add exported circuits only after token economics (who funds fees, pool vs user) is fixed.

## Version alignment

Match **Compact compiler**, **compact-runtime**, and **ledger** generation (`ledger-v7` / `ledger-v8`) to the same stack as your `midnight-js` and wallet SDK versions (see [example-counter](https://github.com/midnightntwrk/example-counter) and release notes).
