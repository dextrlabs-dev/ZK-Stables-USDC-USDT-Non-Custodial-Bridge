# Changelog

All notable changes to this prototype are documented here. Versions match git tags when present.

## Unreleased

### Added

- Minimal GitHub Actions **CI** (checkout, Node.js, Aiken install) and README badge ([`ci.yml`](https://github.com/dextrlabs-dev/ZK-Stables-USDC-USDT-Non-Custodial-Bridge/blob/main/.github/workflows/ci.yml)).

### Removed

- Full CI pipeline (workspace typechecks, EVM tests, Cardano checks) in favor of local runs; see the [Usage Guide](../guides/usage.md).

## v0.1.0-alpha.1 -- 2026-04-02

### Added

- GitHub Actions **CI** workflow: workspace typechecks, EVM Hardhat tests with JUnit when `CI=true`, Aiken check, Cardano TS typecheck.
- **Documentation:** [Prototype Status](prototype-status.md), Usage Guide, [Releases](releases.md), test reports README, docs index.
- **Test reports:** CI uploads `test-reports` artifact (`junit-evm.xml`, `aiken-check.log`).
- README **CI badge** for the default branch.

### Changed

- EVM Hardhat config uses `mocha-multi-reporters` in CI for spec + JUnit output.

---

Full release history and tags: [Releases](releases.md)

Source: [`CHANGELOG.md`](https://github.com/dextrlabs-dev/ZK-Stables-USDC-USDT-Non-Custodial-Bridge/blob/main/CHANGELOG.md)
