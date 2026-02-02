# ZK-Stables-USDC-USDT-Non-Custodial-Bridge

## Midnight Compact contracts

The [contract/](contract/) package implements the **Tier A** (one deployment per bridge ticket) and **Tier B** (registry `Map`) Midnight Compact programs from the architecture plan, plus off-chain encoding notes for `depositCommitment`.

```bash
cd contract
npm install
npm run compact   # requires Compact CLI: https://github.com/midnightntwrk/compact
npm run build
```

See [contract/docs/DEPOSIT_COMMITMENT_ENCODING.md](contract/docs/DEPOSIT_COMMITMENT_ENCODING.md) and [contract/docs/LEDGER_ADT_EXTENSION.md](contract/docs/LEDGER_ADT_EXTENSION.md).