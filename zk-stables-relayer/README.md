# ZK-Stables bridge relayer (reference implementation)

Implements the **architecture blueprint** control flow:

1. **Ingest** — `POST /v1/intents/lock` / `POST /v1/intents/burn`, or watchers that read **EVM** `Locked` / `Burned` logs.
2. **Await finality** — if `intent.source.evm.blockNumber` is set, waits `RELAYER_EVM_CONFIRMATIONS` blocks; if `intent.source.cardano.blockHeight` is set and **Yaci Store** (`RELAYER_YACI_URL` or `YACI_URL`) or **Blockfrost** is configured, waits `RELAYER_CARDANO_CONFIRMATIONS` blocks (tip from Yaci or Blockfrost respectively; **Yaci wins** when its URL is set); otherwise a simulated delay (`RELAYER_FINALITY_MS_*`).
3. **Prove** — **`merkle-inclusion-v1`** when EVM `txHash` + `logIndex` are known: Merkle tree over all logs in that tx (OpenZeppelin-style `MerkleProof` + `merkletreejs`, see [`../zk/README.md`](../zk/README.md)). For Cardano-anchored intents, **`stub-sha256-v1`** augments JSON with `eventCommitmentHex` / `depositCommitmentHex` per [`../contract/docs/DEPOSIT_COMMITMENT_ENCODING.md`](../contract/docs/DEPOSIT_COMMITMENT_ENCODING.md). Otherwise stub digest is intent-only.
4. **Destination** — optional **auto-mint** on EVM (`RELAYER_EVM_BRIDGE_MINT` + …) for LOCK; **unlock** on `ZkStablesPoolLock` via `unlockWithInclusionProof` for BURN when pool + underlying token env is set.

**Bridge wallets** — `RELAYER_BRIDGE_EVM_RECIPIENT` and `RELAYER_BRIDGE_CARDANO_RECIPIENT` populate `intent.connected.relayerBridge` on every job and can default `recipient` when `POST` omits it: **LOCK** only from **midnight** (first non-empty bridge address); **BURN** from **evm** → EVM env, from **cardano** → Cardano env, from **midnight** → first non-empty. Optional `RELAYER_BRIDGE_MIDNIGHT_RECIPIENT` is the LOCK recipient for the Cardano lock watcher when `RELAYER_CARDANO_RECIPIENT_STUB` is unset. `GET /v1/bridge/recipients` returns configured addresses; `/v1/health/chains` includes `relayerBridge` configured booleans only.

Also available:

- EVM lock watcher (`RELAYER_EVM_LOCK_ADDRESS`) and burn watcher (`RELAYER_EVM_WRAPPED_TOKEN`).
- Cardano health via **Yaci Store** or **Blockfrost**; Cardano lock watcher (`RELAYER_CARDANO_WATCHER_ENABLED`, `RELAYER_CARDANO_LOCK_ADDRESS`) ingesting UTxOs into `source.cardano` with matching finality waits (Yaci-only for Cardano when `RELAYER_YACI_URL` or `YACI_URL` is set).
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
| `RELAYER_MIDNIGHT_INDEXER_URL` | `http://127.0.0.1:8088/api/v4/graphql` | Indexer ping for health (Midnight indexer **4.x**; override for older stacks) |
| `RELAYER_YACI_URL` | _(unset)_ | Yaci Store API base (e.g. `http://127.0.0.1:8080/api/v1`) — when set, Cardano health, watcher, and finality use **Yaci only**; Blockfrost is not used for Cardano even if a project id is set |
| `YACI_URL` | _(unset)_ | Fallback for `RELAYER_YACI_URL` (e.g. export alongside `cardano/ts`) |
| `RELAYER_BLOCKFROST_PROJECT_ID` | _(unset)_ | [Blockfrost](https://blockfrost.io) project id — used only when no Yaci URL is set |
| `BLOCKFROST_PROJECT_ID` | _(unset)_ | Alias for `RELAYER_BLOCKFROST_PROJECT_ID` |
| `RELAYER_BLOCKFROST_NETWORK` | `preprod` | `preprod` or `mainnet` (must match the project id’s network) |
| `RELAYER_EVM_CONFIRMATIONS` | `1` | Blocks after mined log before proving (finality) |
| `RELAYER_CARDANO_WATCHER_ENABLED` | _(false)_ | Set `true` to poll `RELAYER_CARDANO_LOCK_ADDRESS` via Yaci Store or Blockfrost |
| `RELAYER_CARDANO_LOCK_ADDRESS` | _(unset)_ | Bech32 payment address of the lock script |
| `RELAYER_CARDANO_LOCK_SCRIPT_HASH` | _(unset)_ | Optional hex script hash stored on `source.cardano` |
| `RELAYER_CARDANO_CONFIRMATIONS` | `8` | Block depth after inclusion before proving |
| `RELAYER_CARDANO_POLL_MS` | `8000` | Watcher poll interval |
| `RELAYER_CARDANO_DEST_CHAIN` | `midnight` | Default destination chain label for watcher intents |
| `RELAYER_CARDANO_RECIPIENT_STUB` | _(empty)_ | Recipient field for auto-enqueued lock intents |
| `RELAYER_CARDANO_DEFAULT_ASSET` | `USDC` | `USDC` / `USDT` label for watcher |
| `RELAYER_CARDANO_ASSET_KIND` | `0` | `assetKind` on watcher intents |
| `RELAYER_ZK_SOURCE_CHAIN_ID` / `RELAYER_ZK_DEST_CHAIN_ID` | `0` | UInt32 chain ids in stub `depositCommitment` preimage |
| `RELAYER_EVM_LOCK_ADDRESS` | _(unset)_ | Pool lock contract emitting `Locked` (watcher) |
| `RELAYER_EVM_WRAPPED_TOKEN` | _(unset)_ | Wrapped token emitting `Burned` (burn watcher) |
| `RELAYER_EVM_BURN_ASSET` | `USDC` | `USDC` or `USDT` — sets `asset` / `assetKind` on watcher-enqueued burn jobs (pair with `wUSDC` vs `wUSDT` token address) |
| `RELAYER_EVM_POOL_LOCK` | _(unset)_ | Pool to call `unlockWithInclusionProof` after burn proof |
| `RELAYER_EVM_UNDERLYING_TOKEN` | _(unset)_ | Underlying ERC-20 released on unlock (e.g. mUSDC) |
| `RELAYER_EVM_BRIDGE_MINT` / `RELAYER_EVM_PRIVATE_KEY` | _(unset)_ | Optional auto-mint after LOCK |
| `RELAYER_BRIDGE_EVM_RECIPIENT` | _(unset)_ | `0x` address — relayer bridge EVM wallet; default `recipient` for some POST flows; echoed in `connected.relayerBridge` |
| `RELAYER_BRIDGE_CARDANO_RECIPIENT` | _(unset)_ | Bech32 or hex payment cred — relayer bridge Cardano wallet; same semantics as EVM var for Cardano-sourced BURN and midnight flows |
| `RELAYER_BRIDGE_MIDNIGHT_RECIPIENT` | _(unset)_ | Midnight bech32 destination for Cardano lock watcher when `RELAYER_CARDANO_RECIPIENT_STUB` is empty |

Copy `.env.example` to `.env` and set your project id locally — **do not commit** API keys.

## API

- `GET /health` — liveness
- `GET /v1/health/chains` — optional EVM + Midnight indexer checks (+ `relayerBridge` configured flags)
- `GET /v1/bridge/recipients` — configured `RELAYER_BRIDGE_*` addresses (dev convenience; protect in production)
- `POST /v1/intents/lock` — enqueue lock intent (body: `LockIntent`)
- `POST /v1/intents/burn` — enqueue burn intent (body: `BurnIntent`)
- `GET /v1/jobs` — list jobs (memory; dev only)
- `GET /v1/jobs/:id` — job status + `proofBundle` when ready

## Web UI

Set `VITE_RELAYER_URL=http://127.0.0.1:8787` in `zk-stables-ui` and use **Submit to relayer** on the cross-chain intent card.
