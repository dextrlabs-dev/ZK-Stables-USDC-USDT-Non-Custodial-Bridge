# Relayer (Reference Implementation)

The ZK-Stables relayer is the off-chain service that orchestrates cross-chain bridge operations. Source code lives in [`zk-stables-relayer/`](https://github.com/dextrlabs-dev/ZK-Stables-USDC-USDT-Non-Custodial-Bridge/tree/main/zk-stables-relayer).

## Pipeline

The relayer implements a four-stage control flow for every bridge intent:

1. **Ingest** -- `POST /v1/intents/lock` or `POST /v1/intents/burn`, or on-chain watchers that read EVM `Locked`/`Burned` logs and Cardano lock UTxOs.
2. **Await finality** -- waits for block confirmations on the source chain (EVM, Cardano, or Midnight), or a simulated delay.
3. **Prove** -- `merkle-inclusion-v1` for EVM-sourced intents (Merkle tree over tx logs), `stub-sha256-v1` for Cardano-sourced intents with `eventCommitmentHex`/`depositCommitmentHex`, otherwise a stub digest.
4. **Destination settlement** -- on-chain transaction on the target chain.

## Destination paths

| Source | Destination | Settlement |
|--------|-------------|------------|
| LOCK (EVM) | EVM | `ZkStablesBridgeMint.mintWrapped` |
| LOCK (any) | Cardano | Mint native asset via Mesh `ForgeScript`, lock at `lock_pool` script, then `BridgeRelease` to recipient |
| LOCK (any) | Midnight | `proveHolder` + `mintWrappedUnshielded` |
| BURN (EVM) | EVM | `unlockWithInclusionProof` on `ZkStablesPoolLock` |
| BURN (Cardano/Midnight) | EVM | Operator `unlock` with `burnCommitmentHex` as `burnNonce` |

## Run

```bash
cd zk-stables-relayer
npm install
npm start
```

Default URL: `http://127.0.0.1:8787` (configurable via `RELAYER_PORT`).

### Production

- Copy `.env.production` into your server environment or merge with your secret `.env`.
- Start with `npm run start:prod` (sources `.env.production` then runs the server).
- Fund the relayer wallet on each network (EVM, Cardano, Midnight) as needed.
- Set `RELAYER_MIDNIGHT_CONTRACT_ADDRESS` or `RELAYER_MIDNIGHT_AUTO_DEPLOY=true` for Midnight settlement.

### SRS strict mode

Set `RELAYER_SRS_STRICT=true` to require all SRS-mandated environment variables at startup. The relayer will exit if any required var is missing. See [SRS_RELAYER_REQUIREMENTS.md](https://github.com/dextrlabs-dev/ZK-Stables-USDC-USDT-Non-Custodial-Bridge/blob/main/docs/SRS_RELAYER_REQUIREMENTS.md).

## API endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Liveness check |
| `GET` | `/v1/health/chains` | EVM + Midnight indexer checks, `relayerBridge` status |
| `GET` | `/v1/bridge/recipients` | Configured `RELAYER_BRIDGE_*` addresses |
| `GET` | `/v1/cardano/bridge-metadata` | Lock pool script CBOR + address for Mesh |
| `POST` | `/v1/intents/lock` | Enqueue a LOCK intent |
| `POST` | `/v1/intents/burn` | Enqueue a BURN intent |
| `GET` | `/v1/jobs` | List all jobs (in-memory; dev only) |
| `GET` | `/v1/jobs/:id` | Job status + `proofBundle` when ready |
| `GET` | `/v1/demo/wallets` | Demo wallet addresses (when `RELAYER_ENABLE_DEMO_WALLETS=true`) |

Job responses include a `ui` object with `phaseLabel`, `phaseIndex`, and `phaseCount` for progress UIs.

## Watchers

- **EVM lock watcher**: monitors `RELAYER_EVM_LOCK_ADDRESS` for `Locked` events
- **EVM burn watcher**: monitors `RELAYER_EVM_WRAPPED_TOKEN` (or dual `RELAYER_EVM_WRAPPED_TOKEN_USDC`/`RELAYER_EVM_WRAPPED_TOKEN_USDT`) for `Burned` events
- **Cardano lock watcher**: polls Yaci Store or Blockfrost for UTxOs at `RELAYER_CARDANO_LOCK_ADDRESS` (requires `RELAYER_CARDANO_WATCHER_ENABLED=true`)

## Environment variables

### Core

| Variable | Default | Purpose |
|----------|---------|---------|
| `RELAYER_PORT` | `8787` | HTTP listen port |
| `RELAYER_SRS_STRICT` | `false` | Exit on startup if SRS-required vars are missing |
| `RELAYER_EVM_RPC_URL` | `http://127.0.0.1:8545` | EVM JSON-RPC endpoint |

### Finality and timing

| Variable | Default | Purpose |
|----------|---------|---------|
| `RELAYER_EVM_CONFIRMATIONS` | `1` | Block depth before proving. Use `0` on quiet Anvil. |
| `RELAYER_CARDANO_CONFIRMATIONS` | `8` | Cardano block depth |
| `RELAYER_FINALITY_MS_EVM_DEFAULT` | `3000` | Simulated finality (ms) for EVM |
| `RELAYER_FINALITY_MS_CARDANO_DEFAULT` | `5000` | Simulated finality (ms) for Cardano |
| `RELAYER_FINALITY_MS_MIDNIGHT_DEFAULT` | `2000` | Simulated finality (ms) for Midnight |
| `RELAYER_PROVE_MS` | `500` | Stub proving delay |

### EVM settlement

| Variable | Default | Purpose |
|----------|---------|---------|
| `RELAYER_EVM_BRIDGE_MINT` | -- | `ZkStablesBridgeMint` address |
| `RELAYER_EVM_WRAPPED_TOKEN` | -- | Wrapped token address |
| `RELAYER_EVM_POOL_LOCK` | -- | Pool lock address for `unlockWithInclusionProof` |
| `RELAYER_EVM_UNDERLYING_TOKEN` | -- | Underlying ERC-20 for unlock |
| `RELAYER_EVM_PRIVATE_KEY` | -- | Signer key for settlement txs |
| `RELAYER_EVM_TOKEN_DECIMALS` | `6` | Parse `intent.amount` |

### Cardano

| Variable | Default | Purpose |
|----------|---------|---------|
| `RELAYER_CARDANO_WATCHER_ENABLED` | `false` | Enable lock UTxO polling |
| `RELAYER_CARDANO_BRIDGE_ENABLED` | `false` | Enable Cardano payout txs |
| `RELAYER_CARDANO_LOCK_ADDRESS` | -- | Script address to poll |
| `RELAYER_CARDANO_WALLET_MNEMONIC` | -- | 24-word mnemonic for Mesh wallet |
| `RELAYER_YACI_URL` | -- | Yaci Store API base (takes precedence over Blockfrost) |
| `RELAYER_BLOCKFROST_PROJECT_ID` | -- | Blockfrost project id |
| `RELAYER_BLOCKFROST_NETWORK` | `preprod` | Must match Blockfrost project |
| `RELAYER_CARDANO_POLL_MS` | `8000` | Watcher poll interval |

### Midnight

| Variable | Default | Purpose |
|----------|---------|---------|
| `RELAYER_MIDNIGHT_ENABLED` | `false` | Enable Midnight mint pipeline |
| `GENESIS_SEED_HASH_HEX` | -- | 64-hex HD seed (same as UI/local-cli) |
| `RELAYER_MIDNIGHT_CONTRACT_ADDRESS` | -- | Join an existing contract |
| `RELAYER_MIDNIGHT_AUTO_DEPLOY` | -- | Deploy a new contract at startup |
| `RELAYER_MIDNIGHT_INDEXER_URL` | `http://127.0.0.1:8088/api/v4/graphql` | Indexer for health checks |

### Bridge wallets

| Variable | Purpose |
|----------|---------|
| `RELAYER_BRIDGE_EVM_RECIPIENT` | Default EVM recipient (`0x`) |
| `RELAYER_BRIDGE_CARDANO_RECIPIENT` | Default Cardano recipient (bech32) |
| `RELAYER_BRIDGE_MIDNIGHT_RECIPIENT` | Default Midnight recipient |

## Concurrency

- **Cardano**: Mesh `submitTx` paths run one at a time via `cardanoBridgeMutex.ts` to prevent overlapping UTxO selection.
- **Midnight**: `proveHolder` + `mintWrappedUnshielded` run one job at a time via `midnightPipelineMutex.ts` to prevent LevelDB conflicts.

## Local EVM testnet

Start Anvil so the relayer's EVM health check and the UI match:

```bash
./scripts/anvil-docker.sh   # or: anvil --host 0.0.0.0 --port 8545
```

## Web UI integration

Set `VITE_RELAYER_URL=http://127.0.0.1:8787` in `zk-stables-ui` and use "Submit to relayer" on the cross-chain intent card.
