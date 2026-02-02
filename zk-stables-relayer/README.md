# ZK-Stables bridge relayer (reference implementation)

Implements the **architecture blueprint** control flow:

1. **Ingest** — `POST /v1/intents/lock` / `POST /v1/intents/burn`, or watchers that read **EVM** `Locked` / `Burned` logs.
2. **Await finality** — if an on-chain anchor is present (`intent.source.evm`), waits `RELAYER_EVM_CONFIRMATIONS` blocks; otherwise a simulated delay (`RELAYER_FINALITY_MS_*`).
3. **Prove** — **`merkle-inclusion-v1`** when `txHash` + `logIndex` are known: Merkle tree over all logs in that tx (OpenZeppelin-style `MerkleProof` + `merkletreejs`, see [`../zk/README.md`](../zk/README.md)). Otherwise **`stub-sha256-v1`** (dev only).
4. **Destination** — optional **auto-mint** on EVM (`RELAYER_EVM_BRIDGE_MINT` + …) for LOCK; **unlock** on `ZkStablesPoolLock` via `unlockWithInclusionProof` for BURN when pool + underlying token env is set.

Also available:

- EVM lock watcher (`RELAYER_EVM_LOCK_ADDRESS`) and burn watcher (`RELAYER_EVM_WRAPPED_TOKEN`).
- Cardano Blockfrost health; Cardano lock watcher scaffold (`RELAYER_CARDANO_WATCHER_ENABLED`).
- Midnight indexer ping for health.

## Run

```bash
cd zk-stables-relayer
npm install
npm start
```

Default URL: `http://127.0.0.1:8787` (`RELAYER_PORT`).

### Local Foundry Anvil (EVM testnet)

From the repo root, start Anvil so the relayer’s EVM health check and the UI (wagmi **Localhost**, chain id **31337**) match:

```bash
./scripts/anvil-docker.sh   # or: native `anvil --host 0.0.0.0 --port 8545`
```

See [`../scripts/README-local-evm.md`](../scripts/README-local-evm.md).

## Environment

| Variable | Default | Purpose |
|----------|---------|---------|
| `RELAYER_PORT` | `8787` | HTTP listen port |
| `RELAYER_FINALITY_MS_EVM_DEFAULT` | `3000` | Simulated finality wait (ms) for EVM-sourced intents |
| `RELAYER_FINALITY_MS_CARDANO_DEFAULT` | `5000` | Cardano |
| `RELAYER_FINALITY_MS_MIDNIGHT_DEFAULT` | `2000` | Midnight |
| `RELAYER_PROVE_MS` | `500` | Stub proving delay |
| `RELAYER_HANDOFF_MS` | `300` | Handoff step delay |
| `RELAYER_EVM_RPC_URL` | `http://127.0.0.1:8545` | Foundry **Anvil** / local JSON-RPC for `/v1/health/chains` (override if needed) |
| `RELAYER_MIDNIGHT_INDEXER_URL` | `http://127.0.0.1:8088/api/v1/graphql` | Indexer ping for health |
| `RELAYER_BLOCKFROST_PROJECT_ID` | _(unset)_ | [Blockfrost](https://blockfrost.io) project id (Preprod or Mainnet) — enables Cardano row in `/v1/health/chains` |
| `BLOCKFROST_PROJECT_ID` | _(unset)_ | Alias for `RELAYER_BLOCKFROST_PROJECT_ID` |
| `RELAYER_BLOCKFROST_NETWORK` | `preprod` | `preprod` or `mainnet` (must match the project id’s network) |
| `RELAYER_EVM_CONFIRMATIONS` | `1` | Blocks after mined log before proving (finality) |
| `RELAYER_EVM_LOCK_ADDRESS` | _(unset)_ | Pool lock contract emitting `Locked` (watcher) |
| `RELAYER_EVM_WRAPPED_TOKEN` | _(unset)_ | Wrapped token emitting `Burned` (burn watcher) |
| `RELAYER_EVM_POOL_LOCK` | _(unset)_ | Pool to call `unlockWithInclusionProof` after burn proof |
| `RELAYER_EVM_UNDERLYING_TOKEN` | _(unset)_ | Underlying ERC-20 released on unlock (e.g. mUSDC) |
| `RELAYER_EVM_BRIDGE_MINT` / `RELAYER_EVM_PRIVATE_KEY` | _(unset)_ | Optional auto-mint after LOCK |

Copy `.env.example` to `.env` and set your project id locally — **do not commit** API keys.

## API

- `GET /health` — liveness
- `GET /v1/health/chains` — optional EVM + Midnight indexer checks
- `POST /v1/intents/lock` — enqueue lock intent (body: `LockIntent`)
- `POST /v1/intents/burn` — enqueue burn intent (body: `BurnIntent`)
- `GET /v1/jobs` — list jobs (memory; dev only)
- `GET /v1/jobs/:id` — job status + `proofBundle` when ready

## Web UI

Set `VITE_RELAYER_URL=http://127.0.0.1:8787` in `zk-stables-ui` and use **Submit to relayer** on the cross-chain intent card.
