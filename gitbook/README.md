# ZK-Stables USDC/USDT Non-Custodial Bridge

Privacy-preserving, non-custodial cross-chain stablecoin bridge across EVM, Cardano, and Midnight.

## What is ZK-Stables?

ZK-Stables is a prototype bridge that enables USDC and USDT movement across three blockchain ecosystems using zero-knowledge proofs for privacy and on-chain script enforcement for non-custodial guarantees.

**Supported Chains:**
- **EVM** (Ethereum, Anvil devnet) — Solidity pool lock/unlock and wrapped token contracts
- **Cardano** (Preprod, Yaci DevKit) — Aiken validators for lock/release with replay protection
- **Midnight** (Compact contracts) — Zero-knowledge proofs via `proveHolder` and `mintWrappedUnshielded`

**Bridged Assets:** USDC, USDT -> zkUSDC, zkUSDT (wrapped representations)

## Quick Links

| Resource | Link |
|----------|------|
| [Quickstart Guide](guides/quickstart.md) | Get running in 5 minutes |
| [Architecture Overview](architecture/system-overview.md) | How the bridge works |
| [SDK Reference](components/sdk.md) | Integrate with `zk-stables-sdk` |
| [API Reference](reference/api-reference.md) | Relayer HTTP endpoints |
| [Test Results](testing/test-report.md) | Automated and integration test reports |
| [Benchmark Results](testing/benchmark-results.md) | Latency and throughput measurements |

## Project Status

This is a **research prototype** for architectural validation and integration testing. It is not production-ready. See [Prototype Status](overview/prototype-status.md) for details on limitations and known gaps.

## Repository

Source code: [github.com/dextrlabs-dev/ZK-Stables-USDC-USDT-Non-Custodial-Bridge](https://github.com/dextrlabs-dev/ZK-Stables-USDC-USDT-Non-Custodial-Bridge)
