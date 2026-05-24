# Uptime and incident log

The full operational uptime record + the two incident postmortems live under [`docs/UPTIME.md`](https://github.com/dextrlabs-dev/ZK-Stables-USDC-USDT-Non-Custodial-Bridge/blob/main/docs/UPTIME.md) and [`docs/postmortems/`](https://github.com/dextrlabs-dev/ZK-Stables-USDC-USDT-Non-Custodial-Bridge/tree/main/docs/postmortems).

## Operational window

- **Continuous engineering on `main`:** 2025-12-30 → 2026-04-21 (~115 days, well above the 15-day milestone target).
- **Integration-matrix runs captured under `tmp/`:** 13 timestamped directories, 24 cross-chain jobs reached `phase: "completed"` across 4 routes during the 2026-04-11 → 2026-04-12 window alone.

## Incidents

| Date (UTC) | Incident | Severity | Postmortem |
|---|---|---|---|
| 2026-04-12 ~05:13 | Midnight indexer GraphQL endpoint unreachable for ~90 min; bridge-cli timeout on EVM → Midnight LOCK. EVM + Cardano legs of the same matrix unaffected. | P2 | [docs/postmortems/2026-04-12-midnight-indexer-outage.md](https://github.com/dextrlabs-dev/ZK-Stables-USDC-USDT-Non-Custodial-Bridge/blob/main/docs/postmortems/2026-04-12-midnight-indexer-outage.md) |
| 2026-04-01 | Cardano payout tx couldn't be produced until bridge `changeAddress` was pre-funded with 50 ADA. First-run configuration only. | P3 | [docs/postmortems/2026-04-11-evm-cardano-payout-wallet-funding.md](https://github.com/dextrlabs-dev/ZK-Stables-USDC-USDT-Non-Custodial-Bridge/blob/main/docs/postmortems/2026-04-11-evm-cardano-payout-wallet-funding.md) |
