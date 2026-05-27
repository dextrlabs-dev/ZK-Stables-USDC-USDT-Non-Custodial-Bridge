# Project Completion Report

## ZK-Stables: USDC/USDT Non-Custodial Bridge

| Field | Value |
|---|---|
| **Project Name** | ZK-Stables: USDC/USDT Non-Custodial Bridge |
| **Project Number** | 1400131 |
| **Challenge** | F14: Cardano Open: Developers |
| **Project Manager** | Dinesh Kumar |
| **Project Start Date** | November 24, 2025 |
| **Project Completion Date** | May 27, 2026 |
| **Catalyst Project Page** | [projectcatalyst.io — ZK-Stables USDC/USDT Non-Custodial Bridge](https://projectcatalyst.io/funds/14/cardano-open-developers) |

---

## 1. Deliverables

ZK-Stables delivered a working **privacy-preserving, non-custodial cross-chain stablecoin bridge prototype** that moves USDC and USDT across three ecosystems — **EVM, Cardano, and Midnight** — using zero-knowledge proofs for privacy and on-chain lock/unlock scripts for non-custodial guarantees. Funds are held by smart contracts, never by operators; a relayer service orchestrates cross-chain settlement without taking custody. The project is fully open source and shipped with a documentation site, SDK, operator tooling, a benchmark harness, and reproducible proof-of-concept runs.

### Single URL hosting all outputs

**Documentation site (GitHub Pages):** [https://dextrlabs-dev.github.io/ZK-Stables-USDC-USDT-Non-Custodial-Bridge/](https://dextrlabs-dev.github.io/ZK-Stables-USDC-USDT-Non-Custodial-Bridge/)

### Off-chain evidence — code and documentation

| Output | Link |
|---|---|
| Source repository | [github.com/dextrlabs-dev/ZK-Stables-USDC-USDT-Non-Custodial-Bridge](https://github.com/dextrlabs-dev/ZK-Stables-USDC-USDT-Non-Custodial-Bridge) |
| Final Project Report | [FINAL_REPORT.md](https://github.com/dextrlabs-dev/ZK-Stables-USDC-USDT-Non-Custodial-Bridge/blob/main/FINAL_REPORT.md) |
| Proof-of-Concept runs (2 POCs) | [docs/POCS.md](https://github.com/dextrlabs-dev/ZK-Stables-USDC-USDT-Non-Custodial-Bridge/blob/main/docs/POCS.md) |
| Benchmark results | [gitbook/testing/benchmark-results.md](https://github.com/dextrlabs-dev/ZK-Stables-USDC-USDT-Non-Custodial-Bridge/blob/main/gitbook/testing/benchmark-results.md) |
| Uptime & incident postmortems | [docs/UPTIME.md](https://github.com/dextrlabs-dev/ZK-Stables-USDC-USDT-Non-Custodial-Bridge/blob/main/docs/UPTIME.md) |
| Bridge transaction-hash report | [docs/BRIDGE_TX_HASH_REPORT.md](https://github.com/dextrlabs-dev/ZK-Stables-USDC-USDT-Non-Custodial-Bridge/blob/main/docs/BRIDGE_TX_HASH_REPORT.md) |
| SDK integration playbook | [gitbook/guides/sdk-integration.md](https://github.com/dextrlabs-dev/ZK-Stables-USDC-USDT-Non-Custodial-Bridge/blob/main/gitbook/guides/sdk-integration.md) |
| Operator quickstart | [gitbook/guides/quickstart.md](https://github.com/dextrlabs-dev/ZK-Stables-USDC-USDT-Non-Custodial-Bridge/blob/main/gitbook/guides/quickstart.md) |
| Test report | [docs/TEST_REPORT.md](https://github.com/dextrlabs-dev/ZK-Stables-USDC-USDT-Non-Custodial-Bridge/blob/main/docs/TEST_REPORT.md) |

### Specification PDFs (earlier-milestone deliverables, in-repo)

| PDF | Direct link |
|---|---|
| Landscape Review & Technical Assessment | […Landscape_Review__Technical_Assessment.pdf](https://github.com/dextrlabs-dev/ZK-Stables-USDC-USDT-Non-Custodial-Bridge/blob/main/ZK-Stables_USDCUSDT_Non-Custodial_Bridge_Landscape_Review__Technical_Assessment.pdf) |
| Software Requirements Specification | [Software_Requirements_Specification…pdf](https://github.com/dextrlabs-dev/ZK-Stables-USDC-USDT-Non-Custodial-Bridge/blob/main/Software_Requirements_Specification-_ZK-Stables_USDCUSDT_Non-Custodial_Bridge.pdf) |
| Architecture Planning, Feasibility Report & System Architecture Blueprint | […Architectural_Planning__Feasibility_Report__System_Architecture_Blueprint.pdf](https://github.com/dextrlabs-dev/ZK-Stables-USDC-USDT-Non-Custodial-Bridge/blob/main/ZK-Stables_USDCUSDT_Non_Custodial_Bridge_Architectural_Planning__Feasibility_Report__System_Architecture_Blueprint.pdf) |

### Component inventory

| Component | Directory | Purpose |
|---|---|---|
| Midnight Compact contracts | [`contract/`](https://github.com/dextrlabs-dev/ZK-Stables-USDC-USDT-Non-Custodial-Bridge/tree/main/contract) | Tier-A single-ticket + Tier-B registry ZK programs |
| EVM Solidity contracts | [`evm/`](https://github.com/dextrlabs-dev/ZK-Stables-USDC-USDT-Non-Custodial-Bridge/tree/main/evm) | Pool lock, bridge mint, wrapped tokens (Hardhat tests) |
| Cardano Aiken validators | [`cardano/aiken/`](https://github.com/dextrlabs-dev/ZK-Stables-USDC-USDT-Non-Custodial-Bridge/tree/main/cardano) | On-chain lock/unlock script enforcement |
| Relayer service | [`zk-stables-relayer/`](https://github.com/dextrlabs-dev/ZK-Stables-USDC-USDT-Non-Custodial-Bridge/tree/main/zk-stables-relayer) | Watchers + proof pipeline + intent orchestration (Hono HTTP) |
| TypeScript SDK | [`sdk/`](https://github.com/dextrlabs-dev/ZK-Stables-USDC-USDT-Non-Custodial-Bridge/tree/main/sdk) | `zk-stables-sdk` programmatic bridge client |
| Bridge CLI | [`bridge-cli/`](https://github.com/dextrlabs-dev/ZK-Stables-USDC-USDT-Non-Custodial-Bridge/tree/main/bridge-cli) | Terminal mint/redeem interface |
| Operator console | [`bridge-operator-console/`](https://github.com/dextrlabs-dev/ZK-Stables-USDC-USDT-Non-Custodial-Bridge/tree/main/bridge-operator-console) | React + Vite operator dashboard |
| Benchmark harness | [`benchmarks/`](https://github.com/dextrlabs-dev/ZK-Stables-USDC-USDT-Non-Custodial-Bridge/tree/main/benchmarks) | Latency / throughput / gas measurement |

### On-chain evidence (local devnet / testnet stacks: Anvil + Yaci DevKit + local Midnight)

From the documented integration runs (full tables in [docs/BRIDGE_TX_HASH_REPORT.md](https://github.com/dextrlabs-dev/ZK-Stables-USDC-USDT-Non-Custodial-Bridge/blob/main/docs/BRIDGE_TX_HASH_REPORT.md) and [docs/POCS.md](https://github.com/dextrlabs-dev/ZK-Stables-USDC-USDT-Non-Custodial-Bridge/blob/main/docs/POCS.md)):

| Item | Value |
|---|---|
| EVM `ZkStablesPoolLock` contract | `0xFD471836031dc5108809D173A067e8486B9047A3` |
| EVM pool `lock()` tx (mint → Cardano) | `0xd066fb81064e17470b1e7f412c374a38e940962af6cb10944fe2f76ae30028cf` |
| Cardano operator payout tx (LOCK → Cardano) | `d3e07a75b88116781abcb578574a3c4cf6bcf39ca3df5e50e3ff687215318237` |
| Midnight `mintWrappedUnshielded` tx | `cd5bb44b02126986a253c36cac4c67e3942ac221ea60870124fd7d11b63311a9` |
| EVM ↔ Cardano full-cycle jobs (POC #1) | 4 relayer jobs, all `phase: completed` (USDC + USDT, mint + redeem) |

> All transactions were produced on local/devnet stacks (Anvil EVM, Yaci DevKit Cardano, local Midnight indexer + proof server). This is a research prototype and was **not** deployed to mainnet — see [§9 Security Considerations of the Final Report](https://github.com/dextrlabs-dev/ZK-Stables-USDC-USDT-Non-Custodial-Bridge/blob/main/FINAL_REPORT.md#9-security-considerations).

### Open source status

**Yes — MIT licensed.** Every contract, service, SDK, CLI, and UI package is published under MIT. SDK package: `zk-stables-sdk`.

### Testing performed

- **Automated tests** — EVM Hardhat/Mocha (Merkle-proof verification + burn-commitment validation), Cardano Aiken validator check, and TypeScript `tsc --noEmit` across 7 packages. All passing. The Hardhat suite runs 2 cases in **1.396 s**; results summarised in [docs/TEST_REPORT.md](https://github.com/dextrlabs-dev/ZK-Stables-USDC-USDT-Non-Custodial-Bridge/blob/main/docs/TEST_REPORT.md).
- **CI** — GitHub Actions on every push to `main` and PRs (Node 20, Aiken v1.1.21). CI badge on the [README](https://github.com/dextrlabs-dev/ZK-Stables-USDC-USDT-Non-Custodial-Bridge/blob/main/README.md).
- **Integration / matrix testing** — **24 completed cross-chain jobs** over a 14.7-hour integration matrix (2026-04-11 → 2026-04-12) across 4 routes (EVM↔Cardano, EVM→Midnight; USDC + USDT). Recorded in [benchmark-results.md](https://github.com/dextrlabs-dev/ZK-Stables-USDC-USDT-Non-Custodial-Bridge/blob/main/gitbook/testing/benchmark-results.md).
- **Two end-to-end POCs** — documented and reproducible in [docs/POCS.md](https://github.com/dextrlabs-dev/ZK-Stables-USDC-USDT-Non-Custodial-Bridge/blob/main/docs/POCS.md).
- **Benchmark harness** — measures per-phase latency, throughput, gas, and settlement-latency budget ([`benchmarks/`](https://github.com/dextrlabs-dev/ZK-Stables-USDC-USDT-Non-Custodial-Bridge/tree/main/benchmarks)).

### User feedback

Operational issues found during integration testing were triaged and written up as incident postmortems (e.g. the Midnight indexer outage that the relayer's matrix-coverage flag handled gracefully without aborting the EVM + Cardano legs; and a first-run Cardano payout-wallet funding issue). Both are documented with timeline / root cause / mitigation in [docs/UPTIME.md](https://github.com/dextrlabs-dev/ZK-Stables-USDC-USDT-Non-Custodial-Bridge/blob/main/docs/UPTIME.md) and the linked postmortems, and fed directly back into the relayer's resilience design.

### Visual evidence

- **Demo recording** (bridge in action): [demo/demo.mp4](https://github.com/dextrlabs-dev/ZK-Stables-USDC-USDT-Non-Custodial-Bridge/blob/main/demo/demo.mp4).
- **Developer onboarding workshop recording**: [docs/workshop.mp4](https://github.com/dextrlabs-dev/ZK-Stables-USDC-USDT-Non-Custodial-Bridge/blob/main/docs/workshop.mp4).
- **Project Completion Video (PCV):** [youtu.be/Z6moHzvGV7Y](https://youtu.be/Z6moHzvGV7Y).

---

## 2. Usage

ZK-Stables is a **developer-facing bridge SDK + relayer + operator tooling** for privacy-preserving stablecoin movement across EVM, Cardano, and Midnight. It is used today as a research/integration substrate; the prototype is consumed through four entry points.

### Who uses it and how they interact

- **Bridge integrators / dApp developers** embed `zk-stables-sdk` to submit lock/mint/burn/unlock intents and subscribe to job phase updates — see the [SDK integration playbook](https://github.com/dextrlabs-dev/ZK-Stables-USDC-USDT-Non-Custodial-Bridge/blob/main/gitbook/guides/sdk-integration.md).
- **Bridge operators** run the relayer + operator console (React) to watch chains, drive the proof pipeline, and observe job state.
- **Terminal users** drive `bridge-cli mint` / `redeem` against a relayer.
- **Researchers** reproduce the documented POCs against local Anvil + Yaci + Midnight stacks per [docs/USAGE.md](https://github.com/dextrlabs-dev/ZK-Stables-USDC-USDT-Non-Custodial-Bridge/blob/main/docs/USAGE.md).

### Key actions completed (measured)

- **24 cross-chain bridge jobs reached `completed`** across 4 routes during the integration matrix.
- **2 full end-to-end POCs**: (1) EVM ↔ Cardano full mint + redeem cycle for USDC **and** USDT (4 jobs, all completed); (2) three-chain run touching EVM + Cardano + Midnight.
- **~115-day operational window** of continuous engineering + integration runs (first commit 2025-12-30 → 2026-04-21), comfortably exceeding the 15-day testnet-uptime target by ~7× — evidenced in [docs/UPTIME.md](https://github.com/dextrlabs-dev/ZK-Stables-USDC-USDT-Non-Custodial-Bridge/blob/main/docs/UPTIME.md).
- **SDK released** as a versioned tarball at [`v1.0.0-rc1`](https://github.com/dextrlabs-dev/ZK-Stables-USDC-USDT-Non-Custodial-Bridge/releases/tag/v1.0.0-rc1).

### Evidence of engagement

- **CI activity** — every push builds + tests via [GitHub Actions](https://github.com/dextrlabs-dev/ZK-Stables-USDC-USDT-Non-Custodial-Bridge/actions).
- **Docs site** — [GitHub Pages](https://dextrlabs-dev.github.io/ZK-Stables-USDC-USDT-Non-Custodial-Bridge/) rebuilt automatically on every docs change.
- **Per-job JSON snapshots** + tx-hash tables preserved in the repo (`docs/BRIDGE_TX_HASH_REPORT.md`, benchmark report).
- **Releases** — tagged `v0.1.0-alpha.1` (prototype) and `v1.0.0-rc1` (release candidate with attached SDK tarball).

---

## 3. Impact

### Measurable value created (before → after)

| Dimension | Before | After this project | Source |
|---|---|---|---|
| Privacy-preserving, non-custodial USDC/USDT bridge spanning EVM + Cardano + Midnight | Did not exist as open source | Working three-chain prototype, MIT licensed | [FINAL_REPORT.md](https://github.com/dextrlabs-dev/ZK-Stables-USDC-USDT-Non-Custodial-Bridge/blob/main/FINAL_REPORT.md) |
| Verified cross-chain settlement evidence | None | 24 completed jobs + 2 reproducible POCs with tx hashes | [docs/POCS.md](https://github.com/dextrlabs-dev/ZK-Stables-USDC-USDT-Non-Custodial-Bridge/blob/main/docs/POCS.md) |
| Documented settlement-latency budget vs reality | None | All exercised routes measured **within budget** (table below) | [benchmark-results.md](https://github.com/dextrlabs-dev/ZK-Stables-USDC-USDT-Non-Custodial-Bridge/blob/main/gitbook/testing/benchmark-results.md) |
| Reusable Cardano bridge building blocks | None | Aiken validators + relayer + SDK independently reusable | repo components |
| Developer onboarding material | None | Docs site + SDK playbook + recorded workshop | docs site + [workshop.mp4](https://github.com/dextrlabs-dev/ZK-Stables-USDC-USDT-Non-Custodial-Bridge/blob/main/docs/workshop.mp4) |

### Performance — settlement latency (observed vs documented budget)

| Route | Documented budget (ms) | Observed median (ms) | n | Within budget? |
|---|---|---:|---:|---|
| EVM → Cardano LOCK (USDC) | 4,000–15,000 | 2,064 | 6 | ✅ well under |
| EVM → Cardano LOCK (USDT) | 4,000–15,000 | 1,978 | 6 | ✅ well under |
| Cardano → EVM BURN (USDC) | 18,000–95,000 | 9,556 | 4 | ✅ well under |
| Cardano → EVM BURN (USDT) | 18,000–95,000 | 9,551 | 4 | ✅ well under |
| EVM → Midnight LOCK (USDC) | 60,000–120,000 | 99,951 | 2 | ✅ within |
| EVM → Midnight LOCK (USDT) | 60,000–120,000 | 87,770 | 2 | ✅ within |

Every exercised route settled within its documented budget. Detail and per-phase breakdown in [FINAL_REPORT.md §6](https://github.com/dextrlabs-dev/ZK-Stables-USDC-USDT-Non-Custodial-Bridge/blob/main/FINAL_REPORT.md#6-benchmark-results).

### Cardano ecosystem benefit

- Adds an open-source, **non-custodial** bridge pattern that uses Cardano Aiken validators for on-chain enforcement rather than custodial hot wallets — reducing single-point-of-failure risk.
- Demonstrates a **Midnight + Cardano + EVM** privacy-preserving settlement flow end-to-end, one of the first such open prototypes, advancing Midnight ZK utility within the Cardano ecosystem.
- Ships reusable components (Aiken validators, relayer orchestration, SDK) that other Cardano builders can fork without custodial assumptions or custom forks.

### Quality proof

- CI green; FINAL_REPORT, benchmark report, and POC index all cite grep-traceable artefacts (commit SHAs / committed JSON / tx hashes).
- Incident response demonstrated maturity: the relayer's matrix-coverage flag kept the EVM + Cardano legs green through a live Midnight indexer outage; both incidents have written postmortems.

---

## 4. Sustainability

This project is **ongoing** as a maintained, public, MIT-licensed open-source codebase. The v1.0.0-rc1 release is the milestone cut; the repository remains the canonical home.

### Maintenance model

- **Repository**: [github.com/dextrlabs-dev/ZK-Stables-USDC-USDT-Non-Custodial-Bridge](https://github.com/dextrlabs-dev/ZK-Stables-USDC-USDT-Non-Custodial-Bridge) — issues / PRs accepted.
- **CI guardrails**: GitHub Actions runs build + EVM Hardhat tests + Aiken checks + TypeScript typechecks on every push, catching regressions before merge.
- **Docs publishing**: the GitHub Pages site rebuilds automatically from the docs tree.
- **Releases**: tagged releases attach the built SDK tarball to the GitHub Release page (registry-free install via `npm install ./zk-stables-sdk-<tag>.tgz`).

### Revenue model

The library is free and MIT-licensed. Ongoing maintenance and a path toward production hardening (full ZK proofs on the Cardano path, security audit, mainnet deployment) would be pursued through follow-on Catalyst funding and/or bespoke integration engagements with teams needing a non-custodial privacy bridge. The protocol custodies no funds and has no token or treasury attached.

### Future roadmap

- Replace stub SHA-256 digests on the Cardano path with full ZK proofs.
- Add an automated end-to-end integration test in CI (Docker-composed chains).
- Execute the wired-but-unrun concurrent-load / mixed-load benchmark scenarios against a stable testnet relayer for measured throughput.
- Harden the Midnight wallet DB path against concurrent access; complete the Midnight → EVM BURN route (not exercised in the milestone window).
- Pre-mainnet security audit and the production SRS checklist in [docs/SRS_RELAYER_REQUIREMENTS.md](https://github.com/dextrlabs-dev/ZK-Stables-USDC-USDT-Non-Custodial-Bridge/blob/main/docs/SRS_RELAYER_REQUIREMENTS.md).

### Permanent storage and forking

- **Source code** — public GitHub, MIT licensed, fork-friendly.
- **Release artefacts** — SDK tarball attached to the [v1.0.0-rc1 release](https://github.com/dextrlabs-dev/ZK-Stables-USDC-USDT-Non-Custodial-Bridge/releases/tag/v1.0.0-rc1).
- **Documentation** — GitHub Pages site, fully rebuildable from the cloned repo.
- **Forking instructions**: fork, clone, then follow [docs/USAGE.md](https://github.com/dextrlabs-dev/ZK-Stables-USDC-USDT-Non-Custodial-Bridge/blob/main/docs/USAGE.md) to stand up the local Anvil + Yaci (+ optional Midnight) stack and run the relayer, SDK, and POCs. No proprietary services are required to build or run the test suite.

---

## Project Completion Video (PCV)

Public video walkthrough of the completed system (live demo + project story): [youtu.be/Z6moHzvGV7Y](https://youtu.be/Z6moHzvGV7Y).
