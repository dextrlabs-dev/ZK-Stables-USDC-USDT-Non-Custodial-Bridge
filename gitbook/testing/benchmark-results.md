# Benchmark Results

Benchmarks measure the relayer's end-to-end performance under realistic bridge workloads. They exercise the full intent-to-job pipeline against local stacks (Anvil, Yaci, Midnight) and report per-phase timing, gas costs, and throughput.

## Running benchmarks

From the repository root:

```bash
# Standard benchmark suite
npm run bench

# Full benchmark suite (all scenarios, higher concurrency)
npm run bench:full
```

See [`benchmarks/.env.example`](https://github.com/dextrlabs-dev/ZK-Stables-USDC-USDT-Non-Custodial-Bridge/blob/main/benchmarks/.env.example) for configuration options (relayer URL, EVM RPC, concurrency, timeouts, report paths).

## What is measured

| Metric | Description |
|--------|-------------|
| **Per-phase latency** | Time spent in each relayer phase: `received`, `awaiting_finality`, `proving`, `destination_handoff`, `completed` |
| **Throughput** | Intents processed per second under concurrent load |
| **EVM gas costs** | Gas consumed by `lock()`, `mintWrapped()`, `burn()`, and `unlockWithInclusionProof()` transactions |
| **Settlement latency budget** | End-to-end time from intent submission to on-chain settlement, broken down by chain |

## Scenarios

| Scenario | Description |
|----------|-------------|
| **single-lock** | One LOCK intent through the full pipeline (baseline latency) |
| **single-burn** | One BURN intent through the redeem/unlock pipeline |
| **concurrent-locks** | Multiple LOCK intents submitted in parallel (`BENCH_CONCURRENCY` controls the degree) |
| **mixed-load** | Interleaved LOCK and BURN intents simulating realistic bridge traffic |

## Configuration

Key environment variables from [`benchmarks/.env.example`](https://github.com/dextrlabs-dev/ZK-Stables-USDC-USDT-Non-Custodial-Bridge/blob/main/benchmarks/.env.example):

| Variable | Default | Purpose |
|----------|---------|---------|
| `BENCH_RELAYER_URL` | `http://127.0.0.1:8787` | Relayer HTTP base URL |
| `BENCH_EVM_RPC_URL` | `http://127.0.0.1:8545` | Anvil / EVM JSON-RPC |
| `BENCH_YACI_URL` | _(unset)_ | Yaci Store API base |
| `BENCH_CONCURRENCY` | `5` | Parallel intent submissions |
| `BENCH_TOTAL_INTENTS` | `20` | Total intents per scenario |
| `BENCH_POLL_MS` | `200` | Job status poll interval |
| `BENCH_JOB_TIMEOUT_MS` | `300000` | Max wait per job (5 min) |
| `BENCH_REPORT_PATH` | `docs/BENCHMARK_REPORT.md` | Markdown report output |
| `BENCH_REPORT_JSON` | `/tmp/zk-stables-benchmark.json` | Machine-readable JSON output |

## Observed run-log results (2026-04-11 → 2026-04-12)

The relayer was driven through **24 completed cross-chain jobs** over a 14.7-hour operational window during the documented integration matrix on 2026-04-11 19:50 UTC through 2026-04-12 10:30 UTC. The numbers below are extracted directly from the per-job JSON snapshots committed under [`tmp/`](https://github.com/dextrlabs-dev/ZK-Stables-USDC-USDT-Non-Custodial-Bridge/tree/main/tmp) (and re-derivable by re-running the integration scripts referenced in [`docs/USAGE.md`](https://github.com/dextrlabs-dev/ZK-Stables-USDC-USDT-Non-Custodial-Bridge/blob/main/docs/USAGE.md)).

### End-to-end job latency by route

End-to-end = time between the relayer's `createdAt` (intent ingested) and `updatedAt` of the terminal `completed` phase. All amounts were `0.02` of the corresponding asset.

| Route | n | min (s) | median (s) | max (s) | Source |
|---|---:|---:|---:|---:|---|
| EVM → Cardano `LOCK` (USDC) | 6 | 1.48 | 2.06 | 2.23 | `tmp/ops-matrix-report*/mint-USDC-cardano.json`, `tmp/ops-all-chains-report/mint-USDC-cardano.json` |
| EVM → Cardano `LOCK` (USDT) | 6 | 1.46 | 1.98 | 2.02 | `tmp/ops-matrix-report*/mint-USDT-cardano.json`, `tmp/ops-all-chains-report/mint-USDT-cardano.json` |
| Cardano → EVM `BURN` (USDC) | 4 | 9.55 | 9.56 | 9.56 | `tmp/ops-matrix-report*/redeem-cardano-USDC.json`, `tmp/ops-all-chains-report/redeem-cardano-USDC.json` |
| Cardano → EVM `BURN` (USDT) | 4 | 9.54 | 9.55 | 9.56 | `tmp/ops-matrix-report*/redeem-cardano-USDT.json`, `tmp/ops-all-chains-report/redeem-cardano-USDT.json` |
| EVM → Midnight `LOCK` (USDC) | 2 | 93.32 | 99.95 | 99.95 | `tmp/ops-midnight-run-*` |
| EVM → Midnight `LOCK` (USDT) | 2 | 83.65 | 87.77 | 87.77 | `tmp/ops-midnight-run-*` |

Per-phase trail is preserved in each JSON file under `job.ui.phaseIndex` / `phaseLabel`. The pipeline emits five phases (`received`, `awaiting_finality`, `proving`, `destination_handoff`, `completed`); the latency above is the wall-clock sum, not a per-phase decomposition.

### Throughput

The runs above are **single-intent serial** (each new job submitted after the prior completed), not concurrent load. Concurrent-load benchmarks (`benchmarks/src/scenarios/concurrent-locks.ts`, `mixed-load.ts`) are wired into the harness but have not been executed yet against a stable testnet relayer; reviewers should treat throughput numbers as **not measured** until those scenarios run. The serial cadence in the existing runs was 1 job every ~11 s on the Cardano routes and 1 job every ~100 s on the Midnight route — bounded by per-intent settlement latency, not by harness throughput.

### EVM gas observations

The Hardhat suite in [`evm/test-results/junit-evm.xml`](https://github.com/dextrlabs-dev/ZK-Stables-USDC-USDT-Non-Custodial-Bridge/blob/main/evm/test-results/junit-evm.xml) (timestamp `2026-04-21T09:19:47`) covers 2 test cases in **1.396 s** total: the `burn → burnCommitment` round-trip (1.361 s) and the Merkle-vs-merkletreejs equivalence check (0.025 s). The Hardhat gas reporter was not enabled for that run; rerun with `REPORT_GAS=true npm test` inside `evm/` to capture per-method gas — the values will land under `evm/.gas-report.txt` if the gas-reporter config flag is set.

### Known partial / failed runs (incident material)

These appear in the `tmp/` corpus and are written up as postmortems in [`docs/UPTIME.md`](https://github.com/dextrlabs-dev/ZK-Stables-USDC-USDT-Non-Custodial-Bridge/blob/main/docs/UPTIME.md):

- `tmp/ops-all-chains-report/TX_HASH_REPORT.md` — "Midnight not run: Midnight indexer unreachable at `http://127.0.0.1:8088/api/v4/graphql`: `TypeError: fetch failed`". Matrix-coverage flag let the EVM + Cardano legs of the same run complete normally.
- `tmp/midnight-hash-report/summary.json` — "Partial run: zk-bridge mint USDC→midnight: Command failed" — `bridge-cli` timeout against the same indexer outage.

### Settlement latency budget

The full settlement-latency budget (target vs observed) is in [`FINAL_REPORT.md` §6](https://github.com/dextrlabs-dev/ZK-Stables-USDC-USDT-Non-Custodial-Bridge/blob/main/FINAL_REPORT.md#6-performance--latency).
