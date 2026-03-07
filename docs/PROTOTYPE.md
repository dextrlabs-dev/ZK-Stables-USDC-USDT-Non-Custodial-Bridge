# Prototype status

This repository is a **non-custodial bridge prototype** between stablecoin rails (for example USDC / USDT on EVM), **Midnight** (Compact contracts, ZK circuits), and **Cardano** (Aiken validators plus TypeScript off-chain helpers). It is intended for research, integration testing on local stacks, and architectural validation—not for production custody or mainnet deployment without a full security review.

## What is implemented

- **Midnight (`contract/`, `local-cli/`, `zk-stables-ui/`)** — Tier A / Tier B Compact programs, managed artifacts, local deploy and operation scripts against an undeployed / local Midnight network, and a browser dApp patterned on Midnight example apps.
- **EVM (`evm/`)** — Solidity contracts (including wrapped stable representation and bridge mint paths) with Hardhat tests and local Anvil-oriented scripts.
- **Cardano (`cardano/`)** — Aiken validators and TypeScript CLI flows (lock, refund, release, registry) using Mesh SDK.
- **Relayer (`zk-stables-relayer/`)** — HTTP service wiring cross-chain concerns (TypeScript).

## What is not guaranteed

- No warranty of economic safety, liveness, or correctness under adversarial conditions.
- Toolchain versions (Compact CLI, Midnight node/indexer/proof-server, wallet SDKs) must stay aligned; mismatches produce subtle runtime failures.
- **Compact compilation** (`npm run compact` in `contract/`) requires the [Compact CLI](https://github.com/midnightntwrk/compact) on the developer machine and is not executed in the default GitHub Actions job (CI runs TypeScript typecheck against committed managed sources, EVM tests, and Aiken check).

## CI

Continuous integration runs on pushes and pull requests to `main` / `master` (see [.github/workflows/ci.yml](../.github/workflows/ci.yml)). The README badge reflects the latest workflow result on the default branch.
