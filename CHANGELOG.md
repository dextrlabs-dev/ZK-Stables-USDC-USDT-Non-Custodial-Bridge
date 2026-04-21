# Changelog

All notable changes to this prototype are documented here. Versions match git tags when present.

## Unreleased

### Added

- Minimal GitHub Actions **CI** (checkout, Node.js, Aiken install) and README badge ([.github/workflows/ci.yml](.github/workflows/ci.yml)).

### Removed

- Full CI pipeline (workspace typechecks, EVM tests, Cardano checks) in favor of local runs; see [docs/USAGE.md](docs/USAGE.md).

## [v0.1.0-alpha.1] - 2026-04-02

### Added

- GitHub Actions **CI** workflow: workspace typechecks, EVM Hardhat tests with JUnit when `CI=true`, Aiken check, Cardano TS typecheck.
- **Documentation:** [docs/PROTOTYPE.md](docs/PROTOTYPE.md), [docs/USAGE.md](docs/USAGE.md), [docs/RELEASES.md](docs/RELEASES.md), [docs/reports/README.md](docs/reports/README.md), [docs/README.md](docs/README.md).
- **Test reports:** CI uploads `test-reports` artifact (`junit-evm.xml`, `aiken-check.log`).
- README **CI badge** for the default branch.

### Changed

- EVM Hardhat config uses `mocha-multi-reporters` in CI for spec + JUnit output.

[v0.1.0-alpha.1]: https://github.com/MoFayaz/ZK-Stables-USDC-USDT-Non-Custodial-Bridge/releases/tag/v0.1.0-alpha.1
