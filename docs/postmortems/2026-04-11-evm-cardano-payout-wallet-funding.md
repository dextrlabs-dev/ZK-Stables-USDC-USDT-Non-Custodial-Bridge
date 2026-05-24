# Postmortem — Cardano payout blocked by unfunded bridge wallet (first-run only)

**Date:** 2026-04-01 (originally), recurring on every fresh Yaci devnet boot through the 2026-04-11 → 2026-04-12 integration window.
**Severity:** P3 — predictable, configuration-only, blocks Cardano payouts on a fresh local stack.
**Status:** Resolved by documented pre-fund step; turned into a routine setup checklist item.
**Author:** Trivolve / Dextr Labs operations.

## Summary

The first EVM → Cardano `LOCK` against a freshly-booted Yaci devnet could not produce a `Cardano payout tx` because the bridge's Mesh-derived address (for the `abandon … about` demo mnemonic) held zero ADA. The relayer's Cardano builder reported a wallet-balance / UTxO-availability error rather than crashing. Once the bridge address was pre-funded with 50 ADA from the Yaci `utxo1` key, every subsequent payout produced a real tx hash.

This was a setup-checklist gap, not a code defect. It's written up here because reviewers will see four months of `tmp/` runs all reference the same pre-fund tx (`d72589d1…3273bb5d0`), and the documentation needs to make that dependency explicit.

## Timeline

| Date | Event | Artefact |
|---|---|---|
| 2026-04-01 | First three-chain integration run. Cardano payout fails for lack of bridge-wallet funding. Operator funds via `cardano-cli` inside the Yaci container; pre-fund tx `d72589d1821994e87654424f13eadc0b17eae71499735dd18064c2f3273bb5d0`. From this point onward the payout produces tx `d3e07a75…318237`. | `docs/BRIDGE_TX_HASH_REPORT.md` §1 |
| 2026-04-11 → 2026-04-12 | Every fresh-devnet matrix run starts with the same pre-fund step; the relayer's setup script invokes it automatically when it detects the wallet has zero UTxOs. | `tmp/ops-all-chains-report/`, `tmp/ops-matrix-report*` |

## Impact

- **First-run friction**: any operator who skips the pre-fund step sees a confusing "Cardano payout tx: (none)" line in the run summary.
- **No on-chain inconsistency**: the EVM-side `lock()` still produces a real tx; the relayer simply parks the job in `awaiting_finality` until the Cardano payout builder can satisfy its balance check.

## Root cause

The local Yaci devnet boots with the genesis UTxO concentrated in a small number of demo keys (`utxo1` etc.). The bridge wallet derived from the `abandon … about` Mesh mnemonic shares no UTxOs with those keys; without an explicit funding step it has zero spendable balance.

## Mitigations applied

- The setup checklist in [`docs/BRIDGE_TX_HASH_REPORT.md`](../BRIDGE_TX_HASH_REPORT.md) calls out the 50 ADA pre-fund step as a hard precondition before any EVM → Cardano `LOCK` matrix run.
- The local Yaci stack docs at [`docs/CARDANO_LOCAL_YACI.md`](../CARDANO_LOCAL_YACI.md) walk through the `cardano-cli build|sign|submit` sequence from inside the Yaci container.

## Follow-ups

- **(open)** Move the pre-fund step into a setup script under `local-cli/` so a single `npm run local:bootstrap` configures Anvil + Yaci + Midnight + bridge-wallet funding in one shot.
- **(open)** Surface bridge-wallet balance in `/v1/health` so the operator console can show a red banner before the first payout run instead of after a failure.
