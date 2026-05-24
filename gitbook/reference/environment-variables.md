# Environment Variables

All configuration for the ZK-Stables relayer is done through environment variables. Copy [`zk-stables-relayer/.env.example`](https://github.com/dextrlabs-dev/ZK-Stables-USDC-USDT-Non-Custodial-Bridge/blob/main/zk-stables-relayer/.env.example) to `.env` and customize. **Do not commit API keys or private keys.**

---

## Core

| Variable | Default | Description |
|----------|---------|-------------|
| `RELAYER_PORT` | `8787` | HTTP listen port |
| `RELAYER_HOST` | `0.0.0.0` | Bind address |
| `RELAYER_SRS_STRICT` | `false` | If `true`, exit on startup unless **all** SRS-required env vars are set (EVM lock/burn/pool/mint keys, Cardano indexer + watcher + bridge + wallet, Midnight wallet + contract, demo wallets + three `RELAYER_BRIDGE_*` recipients) |
| `RELAYER_REQUIRE_MIDNIGHT_AND_CARDANO` | `false` | Legacy: if `true` and `RELAYER_SRS_STRICT` is not `true`, only Midnight + Cardano checks run |

---

## EVM

| Variable | Default | Description |
|----------|---------|-------------|
| `RELAYER_EVM_RPC_URL` | `http://127.0.0.1:8545` | Foundry Anvil / JSON-RPC endpoint for health and watchers |
| `RELAYER_EVM_PRIVATE_KEY` | _(unset)_ | Hex private key for bridge mint and unlock transactions |
| `RELAYER_EVM_CONFIRMATIONS` | `1` | Blocks after mined log before proving. Use `0` on quiet Anvil chains |
| `RELAYER_EVM_LOCK_ADDRESS` | _(unset)_ | Pool lock contract address emitting `Locked` (watcher) |
| `RELAYER_EVM_LOCK_DEST_CHAIN` | `midnight` | Destination label on watcher-enqueued LOCK intents (`evm` for same-chain tests) |
| `RELAYER_EVM_WRAPPED_TOKEN` | _(unset)_ | Wrapped token address emitting `Burned` (burn watcher) |
| `RELAYER_EVM_WRAPPED_TOKEN_USDC` | _(unset)_ | Optional separate USDC wrapped token address (dual watcher) |
| `RELAYER_EVM_WRAPPED_TOKEN_USDT` | _(unset)_ | Optional separate USDT wrapped token address (dual watcher) |
| `RELAYER_EVM_BURN_ASSET` | `USDC` | `USDC` or `USDT` -- sets `asset`/`assetKind` on watcher burn jobs when using single `RELAYER_EVM_WRAPPED_TOKEN` |
| `RELAYER_EVM_BRIDGE_MINT` | _(unset)_ | `ZkStablesBridgeMint` contract address for auto-mint after LOCK |
| `RELAYER_EVM_POOL_LOCK` | _(unset)_ | Pool contract for `unlockWithInclusionProof` after burn proof |
| `RELAYER_EVM_UNDERLYING_TOKEN` | _(unset)_ | Underlying ERC-20 released on unlock (e.g. mUSDC) |
| `RELAYER_EVM_UNDERLYING_TOKEN_USDT` | _(unset)_ | Optional separate underlying for USDT redeems (defaults to `RELAYER_EVM_UNDERLYING_TOKEN`) |
| `RELAYER_EVM_TOKEN_DECIMALS` | `6` | Decimals when parsing `intent.amount` for mint/unlock |
| `RELAYER_EVM_CROSS_CHAIN_UNLOCK_FALLBACK_NONCE` | _(unset)_ | `proof_digest` = use proof digest as burn nonce fallback; `off` = strict binding |

---

## Cardano

### Indexer

| Variable | Default | Description |
|----------|---------|-------------|
| `RELAYER_YACI_URL` | _(unset)_ | Yaci Store API base (e.g. `http://127.0.0.1:8080/api/v1`). When set, Cardano health, watcher, and finality use Yaci only; Blockfrost is ignored |
| `YACI_URL` | _(unset)_ | Fallback for `RELAYER_YACI_URL` |
| `RELAYER_BLOCKFROST_PROJECT_ID` | _(unset)_ | Blockfrost project id -- used only when no Yaci URL is set |
| `BLOCKFROST_PROJECT_ID` | _(unset)_ | Alias for `RELAYER_BLOCKFROST_PROJECT_ID` |
| `RELAYER_BLOCKFROST_NETWORK` | `preprod` | `preprod` or `mainnet` (must match the project id's network) |

### Watcher

| Variable | Default | Description |
|----------|---------|-------------|
| `RELAYER_CARDANO_WATCHER_ENABLED` | `false` | Set `true` to poll `RELAYER_CARDANO_LOCK_ADDRESS` via Yaci Store or Blockfrost |
| `RELAYER_CARDANO_LOCK_ADDRESS` | _(unset)_ | Bech32 payment address of the lock script |
| `RELAYER_CARDANO_LOCK_SCRIPT_HASH` | _(unset)_ | Optional hex script hash stored on `source.cardano` |
| `RELAYER_CARDANO_CONFIRMATIONS` | `8` | Block depth after inclusion before proving |
| `RELAYER_CARDANO_POLL_MS` | `8000` | Watcher poll interval (ms) |
| `RELAYER_CARDANO_DEST_CHAIN` | `midnight` | Default destination chain label for watcher intents |
| `RELAYER_CARDANO_RECIPIENT_STUB` | _(empty)_ | Recipient field for auto-enqueued lock intents |
| `RELAYER_CARDANO_DEFAULT_ASSET` | `USDC` | `USDC` / `USDT` label for watcher |
| `RELAYER_CARDANO_ASSET_KIND` | `0` | `assetKind` on watcher intents |

### Bridge (on-chain transactions)

| Variable | Default | Description |
|----------|---------|-------------|
| `RELAYER_CARDANO_BRIDGE_ENABLED` | `false` | Set `true` to submit Cardano payout txs from the relayer wallet |
| `RELAYER_CARDANO_WALLET_MNEMONIC` | _(unset)_ | 24-word mnemonic for Mesh `MeshWallet` (fund on your network) |
| `RELAYER_CARDANO_NETWORK_ID` | `0` | `0` = testnet addresses, `1` = mainnet |
| `RELAYER_CARDANO_MESH_NETWORK` | `preprod` | Mesh network id (`preprod`, `preview`, `mainnet`) |
| `RELAYER_CARDANO_PLUTUS_JSON` | _(auto)_ | Absolute path to `cardano/aiken/plutus.json` (from `aiken build`) |
| `RELAYER_CARDANO_PAYOUT_LOVELACE` | `3000000` | Lovelace in the locked UTxO (min-ADA) |
| `RELAYER_CARDANO_PREFLIGHT_MIN_LOVELACE` | _(auto)_ | Min total lovelace the bridge wallet must hold before mint/lock |
| `RELAYER_CARDANO_ASSET_DECIMALS` | `6` | Decimals when interpreting `intent.amount` |
| `RELAYER_CARDANO_MINT_TOKEN_NAME` | _(unset)_ | Override ASCII token name for WUSDC/WUSDT mint (default from `intent.asset`) |
| `RELAYER_CARDANO_MINT_OUTPUT_LOVELACE` | `2000000` | Min lovelace in the lock output carrying minted assets |
| `RELAYER_CARDANO_LOCK_UTXO_WAIT_MS` | `90000` | After lock tx submit, poll indexer until the script UTxO appears |
| `RELAYER_CARDANO_LOCK_UTXO_POLL_MS` | `500` | Delay between polls while waiting for the lock UTxO |
| `RELAYER_CARDANO_RECIPIENT_COMMITMENT_HEX` | _(derived)_ | Optional 64-hex `recipient_commitment` in `LockDatum` |
| `RELAYER_CARDANO_LOCK_SOURCE_CHAIN_ID` | `0` | `source_chain_id` in `LockDatum` |
| `RELAYER_CARDANO_LOCK_DEST_CHAIN_ID` | `0` | `destination_chain_id` in `LockDatum` |
| `RELAYER_CARDANO_LOCK_NONCE` | `0` | `lock_nonce` in `LockDatum` |
| `RELAYER_CARDANO_RELEASE_PAYOUT_ADDRESS` | _(unset)_ | Bech32 payout when BURN recipient is not Cardano |
| `RELAYER_CARDANO_OPERATOR_BURN_RELEASE` | `false` | If `true`, relayer may submit operator `BridgeRelease` for Cardano-sourced BURN |
| `RELAYER_CARDANO_OPERATOR_BURN_RELEASE_TRANSFER_LEGACY` | _(unset)_ | If `true`/`1`, operator release pays synthetic zk to the payout address (old behavior) |
| `RELAYER_CARDANO_DESTINATION_LOCK_HOLD` | `false` | If `true`, LOCK-to-Cardano stops after mint+lock (recipient-only datum for user `BridgeRelease`) |

---

## Midnight

| Variable | Default | Description |
|----------|---------|-------------|
| `RELAYER_MIDNIGHT_ENABLED` | `false` | Run Midnight mint pipeline after LOCK to midnight |
| `RELAYER_MIDNIGHT_INDEXER_URL` | `http://127.0.0.1:8088/api/v4/graphql` | Midnight indexer URL for health checks |
| `RELAYER_MIDNIGHT_PROOF_SERVER` | `http://127.0.0.1:6300` | Midnight proof server URL |
| `GENESIS_SEED_HASH_HEX` | _(unset)_ | **Preferred:** 64 hex chars = 32-byte HD seed (same as UI / `local-cli` `run-genesis`) |
| `BIP39_MNEMONIC` | _(unset)_ | Midnight relayer wallet when `GENESIS_SEED_HASH_HEX` is not set |
| `RELAYER_MIDNIGHT_CONTRACT_ADDRESS` | _(unset)_ | Midnight contract address to join |
| `RELAYER_MIDNIGHT_AUTO_DEPLOY` | _(unset)_ | Set `true` to deploy a new contract on startup |
| `RELAYER_MIDNIGHT_LEVEL_DB_PATH` | `midnight-level-db` | LevelDB directory for Midnight private state (use absolute path in production) |
| `MIDNIGHT_LDB_PASSWORD` | _(dev default)_ | Encryption password for LevelDB (16+ chars; override in production) |
| `RELAYER_MIDNIGHT_WALLET_INIT_MAX_ATTEMPTS` | `6` | Max wallet init retry attempts |
| `RELAYER_MIDNIGHT_WALLET_INIT_RETRY_DELAYS_MS` | `2000,5000,12000,25000,40000,60000` | Comma-separated retry delays |
| `RELAYER_MIDNIGHT_WALLET_SYNC_TIMEOUT_RETRIES` | `2` | Wallet sync timeout retries |
| `RELAYER_MIDNIGHT_FIND_DEPLOYED_TIMEOUT_MS` | `900000` | Timeout for join/sync of contract address |
| `RELAYER_MIDNIGHT_FIND_DEPLOYED_HEARTBEAT_SEC` | `45` | Heartbeat interval during join/sync |

---

## Bridge operator wallets

| Variable | Default | Description |
|----------|---------|-------------|
| `RELAYER_BRIDGE_EVM_RECIPIENT` | _(unset)_ | `0x` address -- relayer bridge EVM wallet. Default `recipient` for some POST flows; echoed in `connected.relayerBridge` |
| `RELAYER_BRIDGE_CARDANO_RECIPIENT` | _(unset)_ | Bech32 or hex payment cred -- relayer bridge Cardano wallet |
| `RELAYER_BRIDGE_MIDNIGHT_RECIPIENT` | _(unset)_ | Midnight bech32 destination (fallback when `RELAYER_CARDANO_RECIPIENT_STUB` is unset) |

---

## Timing and delays

| Variable | Default | Description |
|----------|---------|-------------|
| `RELAYER_FINALITY_MS_EVM_DEFAULT` | `3000` | Simulated finality wait (ms) for EVM-sourced intents |
| `RELAYER_FINALITY_MS_CARDANO_DEFAULT` | `5000` | Simulated finality wait for Cardano |
| `RELAYER_FINALITY_MS_MIDNIGHT_DEFAULT` | `2000` | Simulated finality wait for Midnight |
| `RELAYER_PROVE_MS` | `500` | Stub proving delay (ms) |
| `RELAYER_HANDOFF_MS` | `300` | Handoff step delay (ms) |

---

## ZK / deposit commitment

| Variable | Default | Description |
|----------|---------|-------------|
| `RELAYER_ZK_SOURCE_CHAIN_ID` | `0` | UInt32 source chain id in stub `depositCommitment` preimage |
| `RELAYER_ZK_DEST_CHAIN_ID` | `0` | UInt32 destination chain id in stub `depositCommitment` preimage |

---

## Demo wallets

These variables control the `GET /v1/demo/wallets` endpoint for UI testing.

| Variable | Default | Description |
|----------|---------|-------------|
| `RELAYER_ENABLE_DEMO_WALLETS` | _(false)_ | Set `true` to enable the demo wallets endpoint |
| `RELAYER_DEMO_MNEMONIC_EVM` | Hardhat/Anvil test phrase | Mnemonic for deterministic EVM accounts |
| `RELAYER_DEMO_MNEMONIC_CARDANO` | _(unset)_ | Cardano demo mnemonic |
| `RELAYER_DEMO_MNEMONIC_MIDNIGHT` | _(unset)_ | Midnight demo mnemonic |
| `RELAYER_DEMO_CARDANO_ADDRESS_SRC` | _(unset)_ | Cardano demo source address |
| `RELAYER_DEMO_CARDANO_ADDRESS_DST` | _(unset)_ | Cardano demo destination address |
| `RELAYER_DEMO_MIDNIGHT_SHIELDED` | _(unset)_ | Midnight shielded demo address |
| `RELAYER_DEMO_MIDNIGHT_UNSHIELDED` | _(unset)_ | Midnight unshielded demo address |
| `RELAYER_DEMO_BALANCE_USDC` | `10000` | Mock USDC balance for demo wallets |
| `RELAYER_DEMO_BALANCE_USDT` | `10000` | Mock USDT balance for demo wallets |

---

## Notes

- **Mnemonics and private keys** are only included in demo wallet responses when `NODE_ENV` is not `production`.
- **Cardano concurrency:** Mesh `submitTx` paths run one at a time via `cardanoBridgeMutex.ts` to avoid UTxO contention.
- **Midnight concurrency:** `proveHolder` + `mintWrappedUnshielded` run one job at a time via `midnightPipelineMutex.ts` to avoid LevelDB open errors.
- When `RELAYER_SRS_STRICT=true`, the relayer exits on startup if any required variable is missing. See [`docs/SRS_RELAYER_REQUIREMENTS.md`](https://github.com/dextrlabs-dev/ZK-Stables-USDC-USDT-Non-Custodial-Bridge/blob/main/docs/SRS_RELAYER_REQUIREMENTS.md) for the full checklist.
