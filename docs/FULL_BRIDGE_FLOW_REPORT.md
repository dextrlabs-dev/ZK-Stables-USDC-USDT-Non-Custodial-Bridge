# Full bridge flow report (automated)

The script [`scripts/full-bridge-flow-report.mjs`](../scripts/full-bridge-flow-report.mjs) runs a **single orchestrated pass** and writes:

- `BRIDGE_FLOW_REPORT_JSON` (default `/tmp/zk-stables-bridge-flow-report.json`)
- `BRIDGE_FLOW_REPORT_MD` (default `/tmp/zk-stables-bridge-flow-report.md`)

## What it does

1. **Preflight:** `GET /v1/health/chains` on the relayer.
2. **EVM (optional):** `hardhat run scripts/deploy-anvil.js` + `integration-emit-lock.js` for **mUSDC** and **mUSDT** pool `lock()` → records **EVM tx hashes**.
3. **HTTP LOCK:** Four intents — **USDC/USDT** × destination **Cardano** / **Midnight** (`destinationChain: 'cardano' | 'midnight'`).
4. **HTTP BURN:** Four intents — **Cardano** and **Midnight** sources × **USDC/USDT**, recipient **0x…** (EVM underlying payout path when relayer env is set). Midnight burns use a **synthetic** `source.midnight.txId` for API acceptance (not a real `initiateBurn` tx).
5. **Wait** for each job (up to `BRIDGE_FLOW_JOB_WAIT_MS`, default 180s).
6. **Aggregate** EVM / Cardano / Midnight transaction references by parsing `destinationHint` (same patterns as [`zk-stables-ui/src/lib/relayerTxParsing.ts`](../zk-stables-ui/src/lib/relayerTxParsing.ts)).

## What it does *not* do

- It does **not** submit real **Cardano** `BridgeRelease` or **Midnight** `initiateBurn` from a user wallet. For end-to-end SRS parity, use the UI + funded wallets (see [`docs/SRS_RELAYER_REQUIREMENTS.md`](SRS_RELAYER_REQUIREMENTS.md), [`scripts/srs-e2e-cardano-redeem.sh`](../scripts/srs-e2e-cardano-redeem.sh)).
- It does **not** start Anvil, Yaci, Midnight, or the relayer — start those separately.

## Run

```bash
# Terminal 1: Anvil + relayer (+ optional Yaci / Midnight) with env from
# zk-stables-relayer/.env.integration.example or your .env

# Terminal 2 (repo root):
npm run bridge-flow-report
```

Environment (optional):

| Variable | Purpose |
|----------|---------|
| `RELAYER_URL` | Relayer base URL (default `http://127.0.0.1:8787`) |
| `EVM_RPC_URL` / `RELAYER_EVM_RPC_URL` | Anvil JSON-RPC |
| `DEPLOY_ADDRS_JSON` | Path for deploy output (default `/tmp/zk-stables-anvil-addrs.json`) |
| `BRIDGE_FLOW_SKIP_DEPLOY` | `1` to skip deploy + pool.lock |
| `BRIDGE_CARDANO_RECIPIENT` | Bech32 for LOCK → Cardano |
| `BRIDGE_MIDNIGHT_RECIPIENT` | Midnight destination for LOCK → Midnight |
| `BRIDGE_EVM_PAYOUT_RECIPIENT` | `0x…` for BURN → EVM |
| `BRIDGE_FLOW_SYNTHETIC_MIDNIGHT_TX_ID` | 64 hex (override synthetic Midnight burn anchor) |

If `RELAYER_ENABLE_DEMO_WALLETS=true`, recipients can be taken from `GET /v1/demo/wallets`.

## See also

- [`docs/BRIDGE_TX_HASH_REPORT.md`](BRIDGE_TX_HASH_REPORT.md) — example captured hashes from a three-chain run.
- [`scripts/local-bridge-integration.sh`](../scripts/local-bridge-integration.sh) — lighter smoke (deploy + lock + health).
