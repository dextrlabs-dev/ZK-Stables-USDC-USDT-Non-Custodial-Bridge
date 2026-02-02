# Audit status (FR-3.2.1 / NFR-4.2.2)

This directory contains **reference** Solidity for local Anvil testing. It is **not** production-audited.

Before mainnet:

1. External security audit (no Critical/High per SRS).
2. Formal verification or exhaustive testing of Merkle + `blockhash` window (256 blocks).
3. Governance / multisig for `ZkStablesPoolLock` owner functions and vault upgrades.

See [`../spec/security-nfr-checklist.md`](../spec/security-nfr-checklist.md).
