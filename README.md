# ZK-Stables USDC/USDT Non-Custodial Bridge

[![CI](https://github.com/dextrlabs-dev/ZK-Stables-USDC-USDT-Non-Custodial-Bridge/actions/workflows/ci.yml/badge.svg)](https://github.com/dextrlabs-dev/ZK-Stables-USDC-USDT-Non-Custodial-Bridge/actions/workflows/ci.yml)
[![Docs](https://github.com/dextrlabs-dev/ZK-Stables-USDC-USDT-Non-Custodial-Bridge/actions/workflows/docs.yml/badge.svg)](https://dextrlabs-dev.github.io/ZK-Stables-USDC-USDT-Non-Custodial-Bridge/)
[![Release](https://img.shields.io/github/v/release/dextrlabs-dev/ZK-Stables-USDC-USDT-Non-Custodial-Bridge?include_prereleases&display_name=tag)](https://github.com/dextrlabs-dev/ZK-Stables-USDC-USDT-Non-Custodial-Bridge/releases)

> Privacy-preserving, non-custodial cross-chain stablecoin bridge across EVM, Cardano, and Midnight.

## Links

| Resource | URL |
|----------|-----|
| Documentation Site (GitHub Pages) | [dextrlabs-dev.github.io/ZK-Stables-USDC-USDT-Non-Custodial-Bridge](https://dextrlabs-dev.github.io/ZK-Stables-USDC-USDT-Non-Custodial-Bridge/) |
| Final Project Report | [FINAL_REPORT.md](FINAL_REPORT.md) |
| Benchmark Results | [gitbook/testing/benchmark-results.md](gitbook/testing/benchmark-results.md) |
| Proof-of-Concept Runs | [docs/POCS.md](docs/POCS.md) |
| Uptime & Incident Postmortems | [docs/UPTIME.md](docs/UPTIME.md) |
| SDK Package (`zk-stables-sdk` tarball) | [v1.0.0-rc1 release](https://github.com/dextrlabs-dev/ZK-Stables-USDC-USDT-Non-Custodial-Bridge/releases/tag/v1.0.0-rc1) |
| SDK Integration Playbook | [gitbook/guides/sdk-integration.md](gitbook/guides/sdk-integration.md) |
| Demo Video | [demo/demo.mp4](demo/demo.mp4) |
| Developer Onboarding Workshop (recording) | [docs/workshop.mp4](docs/workshop.mp4) |
| Project Completion Report (PCR) | [PCR.pdf](PCR.pdf) |
| Project Completion Video (PCV) | [youtu.be/Z6moHzvGV7Y](https://youtu.be/Z6moHzvGV7Y) |

## Overview

ZK-Stables bridges USDC and USDT across three blockchain ecosystems using zero-knowledge proofs for privacy and on-chain script enforcement for non-custodial guarantees. Users lock underlying tokens on a source chain, and the relayer service orchestrates proof generation and wrapped token minting on the destination chain — without taking custody of funds.

**Status:** Prototype for research and integration testing. See [docs/PROTOTYPE.md](docs/PROTOTYPE.md) for limitations.

## Quick Start

```bash
npm install
cd contract && npm run compact && npm run build && cd ..
./scripts/start-local-stack.sh    # starts Anvil, deploys EVM, runs relayer + UI
node test-minimal.mjs             # run a LOCK + BURN end-to-end
```

See [docs/USAGE.md](docs/USAGE.md) for detailed per-package instructions.

## Repository Layout

| Directory | Description |
|-----------|-------------|
| `contract/` | Midnight Compact contracts (Tier A single-ticket, Tier B registry) |
| `evm/` | Solidity contracts + Hardhat tests (pool lock, bridge mint, wrapped tokens) |
| `cardano/` | Aiken validators + Mesh SDK off-chain scripts |
| `sdk/` | Bridge SDK — `zk-stables-sdk` ([npm](https://www.npmjs.com/package/zk-stables-sdk)) |
| `zk-stables-relayer/` | Core relayer service (Hono HTTP, watchers, proof pipeline) |
| `bridge-cli/` | Terminal bridge interface (Ink/React CLI) |
| `bridge-operator-console/` | React + Vite operator dashboard |
| `local-cli/` | Midnight local deployment tooling |
| `benchmarks/` | Benchmark and load testing framework |
| `scripts/` | Integration, setup, and demo scripts |
| `docs/` | Documentation, test reports, specifications |
| `gitbook/` | GitBook documentation site source |
| `demo/` | Demo screen recording |

## Midnight Compact Contracts

The [contract/](contract/) package implements the **Tier A** (one deployment per bridge ticket) and **Tier B** (registry `Map`) Midnight Compact programs, plus off-chain encoding notes for `depositCommitment`.

```bash
cd contract
npm install
npm run compact   # requires Compact CLI: https://github.com/midnightntwrk/compact
npm run build
```

See [contract/docs/DEPOSIT_COMMITMENT_ENCODING.md](contract/docs/DEPOSIT_COMMITMENT_ENCODING.md) and [contract/docs/LEDGER_ADT_EXTENSION.md](contract/docs/LEDGER_ADT_EXTENSION.md).

## SDK

Install the bridge SDK for programmatic integration:

```bash
npm install zk-stables-sdk
```

```typescript
import { ZkStablesSdk } from 'zk-stables-sdk';
const sdk = new ZkStablesSdk({ relayerUrl: 'http://127.0.0.1:8787' });
const { jobId } = await sdk.lock({ sourceChain: 'evm', asset: 'USDC', ... });
sdk.on('job', (job) => console.log(job.phase));
sdk.subscribeJob(jobId);
```

See [sdk/INTEGRATION.md](sdk/INTEGRATION.md) for full integration playbooks and [sdk/examples/](sdk/examples/) for runnable POC scripts.

## Benchmarks

Run latency and throughput benchmarks against the local stack:

```bash
npm run bench              # single LOCK scenario
npm run bench:latency      # single-lock + single-burn
npm run bench:throughput   # concurrent LOCKs
npm run bench:full         # all scenarios
```

Observed-run timings from the 2026-04-11 → 2026-04-12 integration matrix (24 completed cross-chain jobs across 4 routes) are in [gitbook/testing/benchmark-results.md](gitbook/testing/benchmark-results.md); the expected-vs-observed settlement latency budget is in [FINAL_REPORT.md §6](FINAL_REPORT.md). See [benchmarks/.env.example](benchmarks/.env.example) for configuration.

## Documentation

- [Documentation Site](https://dextrlabs-dev.github.io/ZK-Stables-USDC-USDT-Non-Custodial-Bridge/) (auto-built from `gitbook/` by [.github/workflows/docs.yml](.github/workflows/docs.yml))
- [SDK Integration Playbook](gitbook/guides/sdk-integration.md)
- [Quickstart (operator)](gitbook/guides/quickstart.md)
- [Proof-of-Concept Runs](docs/POCS.md)
- [Uptime & Incident Postmortems](docs/UPTIME.md)
- [Usage Guide](docs/USAGE.md)
- [Architecture: Bridge Swap Flow](docs/BRIDGE_SWAP_FLOW.md)
- [Test Report](docs/TEST_REPORT.md)
- [Bridge TX Hash Report](docs/BRIDGE_TX_HASH_REPORT.md)
- [Releases & Tags](docs/RELEASES.md)
- [Changelog](CHANGELOG.md)

## Reports (PDFs)

- [Software Requirements Specification](Software_Requirements_Specification-_ZK-Stables_USDCUSDT_Non-Custodial_Bridge.pdf)
- [Landscape Review & Technical Assessment](ZK-Stables_USDCUSDT_Non-Custodial_Bridge_Landscape_Review__Technical_Assessment.pdf)
- [Architecture Blueprint](ZK-Stables_USDCUSDT_Non_Custodial_Bridge_Architectural_Planning__Feasibility_Report__System_Architecture_Blueprint.pdf)
- [Final Project Report](FINAL_REPORT.md)

---

**Prototype** — not for production use without a full security audit. See [FINAL_REPORT.md](FINAL_REPORT.md) for the complete project report.
