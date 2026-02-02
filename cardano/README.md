# Cardano implementation (Phase 3 scaffold)

This repository currently includes a **reference relayer + UI + Midnight contracts** and an **EVM vertical slice**.

Cardano in the PDFs requires:
- On-chain Plutus scripts for **lock/unlock pools** (non-custodial)
- A relayer that observes Cardano events with finality (Ogmios/Kupo or Blockfrost)
- Proof generation and (eventually) on-chain verification

## What exists in this repo (today)

- The relayer supports **Blockfrost** connectivity for health checks (`/v1/health/chains`).
- Phase 3 is implemented as **scaffolding**: watchers and interfaces are added in `zk-stables-relayer` to support Cardano event ingestion when Plutus scripts and canonical asset representation are finalized.

## Next steps (real Cardano)

1. Decide canonical USDC/USDT representation on Cardano:
   - Native tokens (policyId+assetName) vs wrapped representation.
2. Implement Plutus:
   - `LockPool` validator
   - `UnlockPool` validator with nonce/replay protection
3. Choose indexing approach:
   - Kupo (UTxO indexer) + Ogmios (chain sync), or Blockfrost (hosted API)
4. Add relayer durable cursor + reorg/rollback handling.

