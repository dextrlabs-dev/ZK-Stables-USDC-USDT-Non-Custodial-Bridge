## Security & NFR checklist (Phase 9)

This checklist is the gating document for moving from reference implementation → production.

### Smart contract security (NFR-4.2.2)

- [ ] **Threat model** written (assets, adversaries, trust boundaries, assumptions).
- [ ] **Static analysis**: Slither/Mythril (EVM), Plutus validators linting (Cardano), Compact review (Midnight).
- [ ] **Property tests**: replay protection, nonce uniqueness, pause behavior, ownership transfer.
- [ ] **External audit**: no Critical/High (CVSS 7+) accepted.
- [ ] **Upgrade strategy** documented (immutable vs upgradeable).

### Cryptographic security (NFR-4.2.1)

- [ ] Circuit spec defines exactly what is proven (finality, inclusion, nonce rules).
- [ ] Public inputs hashing and serialization is frozen and versioned.
- [ ] Test vectors (golden fixtures) for prover and verifier across languages.
- [ ] Trusted setup or transparent scheme selected and documented.

### Privacy (NFR-4.2.3)

- [ ] Privacy mode defined (what is hidden: amount, recipient, sender; what is public).
- [ ] Metadata leakage assessment (relayer, RPC providers, indexers).
- [ ] Optional selective disclosure flows implemented and tested.

### Performance (NFR-4.1.x)

- [ ] Latency measured end-to-end (lock→mint, burn→unlock) per chain.
- [ ] Proving throughput benchmarked (proofs/min).
- [ ] SDK response times measured for lock/init/status/fee estimation.

### Operational hardening

- [ ] Durable job store (not memory) + restart-safe cursors for watchers.
- [ ] Multi-relayer (active-active) + idempotent submissions.
- [ ] Monitoring dashboards: error rates, queue depth, proving time, chain liveness.
- [ ] Incident playbooks: pause, rollback, key rotation, reorg handling.

