# Proof-of-Concept runs

Two end-to-end cross-chain runs captured in this repository serve as the operational evidence that the ZK-Stables bridge handles real intent → settlement workflows on more than one chain pair. Both runs were captured with the relayer in its default configuration and the standard bridge-cli / API entry points; the artefacts below are reproducible from the same sources cited in [`docs/USAGE.md`](USAGE.md).

The list is also surfaced from [`FINAL_REPORT.md` §5 (Validation)](../FINAL_REPORT.md#5-validation).

## POC #1 — EVM ↔ Cardano full mint + redeem cycle (USDC + USDT)

**Date:** 2026-04-12T05:13:46Z. **Relayer:** `http://127.0.0.1:8787`. **Source:** [`tmp/ops-all-chains-report/`](../tmp/ops-all-chains-report/) (gitignored locally; the canonical narrative is the committed [`docs/BRIDGE_TX_HASH_REPORT.md`](BRIDGE_TX_HASH_REPORT.md), and the per-job snapshots stay re-derivable from the same scripts).

A single matrix run drove all four EVM ↔ Cardano legs through the relayer pipeline (`received → awaiting_finality → proving → destination_handoff → completed`). All four jobs reached `phase: "completed"`. Throughout the run, the matrix-coverage flag also probed the Midnight indexer and correctly flagged it as unreachable without aborting the EVM + Cardano legs — see [`docs/UPTIME.md`](UPTIME.md) for the postmortem.

| Leg | Asset | Direction | Relayer jobId | EVM tx hash | Phase |
|---|---|---|---|---|---|
| Pool `lock()` (mint → Cardano) | USDC | EVM → Cardano | `job_1775970779280_3ac0d729` | `0xe34133e71c381e5bcfce3d7419dc88e23feff10ce1b10a17504022f0c4538c6b` | `completed` |
| Pool `lock()` (mint → Cardano) | USDT | EVM → Cardano | `job_1775970795220_c563477c` | `0xfc5e525d6d758e3b74643cfab46b1979bef412cdbe07149ccbeda986825867c8` | `completed` |
| Underlying `unlock()` (Cardano → EVM redeem) | USDC | Cardano → EVM | `job_1775970802802_1aea34c0` | `0x2319ac6c024812988c6504bf7829be5ae4c885ee512ae3ca7ba4c48a6fc7b8e4` | `completed` |
| Underlying `unlock()` (Cardano → EVM redeem) | USDT | Cardano → EVM | `job_1775970816143_4c26fd28` | `0xba98fcf8ea5d49177604b859aef8944fb0ae9631fbb46056e16a7d5cd24b9598` | `completed` |

End-to-end latencies for this run are folded into the per-route table in [`gitbook/testing/benchmark-results.md`](../gitbook/testing/benchmark-results.md).

**How to reproduce:** follow the local-stack steps in [`docs/USAGE.md`](USAGE.md) (Anvil + Yaci) and [`docs/LOCAL_BRIDGE_INTEGRATION_REPORT.md`](LOCAL_BRIDGE_INTEGRATION_REPORT.md); then drive `@zk-stables/bridge-cli mint` and `redeem` against the local relayer on `http://127.0.0.1:8787`. The matrix script outputs a `tmp/<run-id>/` directory with the same JSON shape used above.

## POC #2 — Three-chain demonstration (EVM + Cardano + Midnight)

**Date:** 2026-04-01. **Relayer:** `http://127.0.0.1:8822`. **Source:** [`docs/BRIDGE_TX_HASH_REPORT.md` §1](BRIDGE_TX_HASH_REPORT.md).

A scripted three-chain run on the Yaci devnet + Anvil + Midnight indexer-undeployed local stack drove a lock on EVM, an anchored payout on Cardano, and a Midnight bind. Bridge wallet (the Mesh/Preview "abandon…about" demo mnemonic) was funded with `50 ADA` from the Yaci `utxo1` key (pre-fund tx `d72589d1…3273bb5d0`) before the bridge legs ran.

| Leg | Tx hash | Notes |
|---|---|---|
| Pre-fund (Yaci `utxo1` → bridge `changeAddress`) | `d72589d1821994e87654424f13eadc0b17eae71499735dd18064c2f3273bb5d0` | Cardano native funding |
| Cardano operator payout (LOCK → Cardano) | `d3e07a75b88116781abcb578574a3c4cf6bcf39ca3df5e50e3ff687215318237` | jobId `job_1775042694432_3a027874` |
| EVM pool `lock()` (mint → Cardano) | `0xd066fb81064e17470b1e7f412c374a38e940962af6cb10944fe2f76ae30028cf` | block 71 |
| EVM `ZkStablesPoolLock` contract | `0xFD471836031dc5108809D173A067e8486B9047A3` | mock USDC at `0x7bc06c…3846650` |
| Earlier two-chain reference run (EVM + Midnight) | `0xdfadedc9c10697680fdb675bd68bc0f291978fbe2d82346e431edbeaf7acdf1a` | block 49, jobId `job_1775041748006_13a11754` |

Bridge wallet (abandon mnemonic):
`addr_test1qq8ac7qqy0vtulyl7wntmsxc6wex80gvcyjy33qffrhm7sh927ysx5sftuw0dlft05dz3c7revpf7jx0xnlcjz3g69mqkt5dmn`

**How to reproduce:** the run uses the same EVM + Yaci stack as POC #1 plus a local Midnight `proof-server` (port 6300) and the indexer GraphQL endpoint (port 8088). The exact relayer config is preserved in the committed `docs/BRIDGE_TX_HASH_REPORT.md`.

## Reproduction notes (both POCs)

- The relayer in both runs ran with `RELAYER_SRS_STRICT=false` (development mode). The production SRS checklist is in [`docs/SRS_RELAYER_REQUIREMENTS.md`](SRS_RELAYER_REQUIREMENTS.md).
- All transactions used a `0.02` per-leg amount (small enough to keep devnet wallet funding cheap).
- The matrix-coverage flag in the relayer lets a run mark a chain "skipped" cleanly when its indexer is unreachable instead of aborting; this is the resilience pattern that kept POC #1 green even though the Midnight indexer was down at run-time.
