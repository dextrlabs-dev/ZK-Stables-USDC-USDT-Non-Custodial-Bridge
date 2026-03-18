# ZK-Stables bridge relayer (reference implementation)

SRS deployments: set **`RELAYER_SRS_STRICT=true`** and satisfy [docs/SRS_RELAYER_REQUIREMENTS.md](../docs/SRS_RELAYER_REQUIREMENTS.md) (all chains and operations — nothing optional).

Implements the **architecture blueprint** control flow:

1. **Ingest** — `POST /v1/intents/lock` (**`sourceChain` must be `evm`** for HTTP mint) / `POST /v1/intents/burn`, or watchers that read **EVM** `Locked` / `Burned` logs (and Cardano lock UTxOs when the Cardano watcher is enabled).
2. **Await finality** — if `intent.source.evm.blockNumber` is set, waits `RELAYER_EVM_CONFIRMATIONS` blocks; if `intent.source.cardano.blockHeight` is set and **Yaci Store** (`RELAYER_YACI_URL` or `YACI_URL`) or **Blockfrost** is configured, waits `RELAYER_CARDANO_CONFIRMATIONS` blocks (tip from Yaci or Blockfrost respectively; **Yaci wins** when its URL is set); otherwise a simulated delay (`RELAYER_FINALITY_MS_*`).
3. **Prove** — **`merkle-inclusion-v1`** when EVM `txHash` + `logIndex` are known: Merkle tree over all logs in that tx (OpenZeppelin-style `MerkleProof` + `merkletreejs`, see [`../zk/README.md`](../zk/README.md)). For Cardano-anchored intents, **`stub-sha256-v1`** augments JSON with `eventCommitmentHex` / `depositCommitmentHex` per [`../contract/docs/DEPOSIT_COMMITMENT_ENCODING.md`](../contract/docs/DEPOSIT_COMMITMENT_ENCODING.md). Otherwise stub digest is intent-only.
4. **Destination** — on-chain settlement when the corresponding env vars are set (required under `RELAYER_SRS_STRICT`):
   - **LOCK → EVM**: `ZkStablesBridgeMint.mintWrapped` (`RELAYER_EVM_BRIDGE_MINT`, `RELAYER_EVM_WRAPPED_TOKEN`, `RELAYER_EVM_PRIVATE_KEY`). Amount uses `RELAYER_EVM_TOKEN_DECIMALS` (default 6). `nonce` defaults to the stub **proof digest** (bytes32) if `intent.source.evm.nonce` is omitted.
   - **BURN → EVM recipient** (`0x…`): `unlockWithInclusionProof` on `RELAYER_EVM_POOL_LOCK` when the burn source is **EVM** and Merkle proof + pool env are present.
   - **BURN (Cardano or Midnight source) → EVM recipient** (`0x…`): operator `unlock` on `RELAYER_EVM_POOL_LOCK` using `burnCommitmentHex` as `burnNonce`, with underlying from `RELAYER_EVM_UNDERLYING_TOKEN` / `RELAYER_EVM_UNDERLYING_TOKEN_USDT` per asset.
   - **LOCK → Cardano** or **BURN → Cardano** (`addr1…` / `addr_test1…`): **Aiken `lock_pool`** (`cardano/aiken`, `plutus.json` via `RELAYER_CARDANO_PLUTUS_JSON` or default path) — **mint** native asset (Mesh `ForgeScript` + [mint](https://meshjs.dev/apis/txbuilder/minting)), **lock** at script with `LockDatum`, then **`BridgeRelease`** to the recipient (two txs). **BURN** with **Cardano source** and non-Cardano destination: **`BridgeRelease`** on `intent.source.cardano` (`txHash` / `outputIndex`); payout bech32 is `intent.recipient` when Cardano, else `RELAYER_BRIDGE_CARDANO_RECIPIENT` or `RELAYER_CARDANO_RELEASE_PAYOUT_ADDRESS`. Bridge wallet needs **collateral** for Plutus spends.
   - **LOCK → Midnight**: `RELAYER_MIDNIGHT_ENABLED` — relayer runs `proveHolder` + `mintWrappedUnshielded` (see `src/midnight/service.ts`).

**Bridge wallets** — `RELAYER_BRIDGE_EVM_RECIPIENT`, `RELAYER_BRIDGE_CARDANO_RECIPIENT`, and `RELAYER_BRIDGE_MIDNIGHT_RECIPIENT` populate `intent.connected.relayerBridge` and default `recipient` when `POST` omits it (SRS: **required** when `RELAYER_SRS_STRICT`). `GET /v1/bridge/recipients` returns configured addresses; `/v1/health/chains` includes `relayerBridge` configured booleans only.

Also available:

- EVM lock watcher (`RELAYER_EVM_LOCK_ADDRESS`) and burn watcher (`RELAYER_EVM_WRAPPED_TOKEN`, or dual `RELAYER_EVM_WRAPPED_TOKEN_USDC` / `RELAYER_EVM_WRAPPED_TOKEN_USDT`).
- Cardano health via **Yaci Store** or **Blockfrost**; Cardano lock watcher (`RELAYER_CARDANO_WATCHER_ENABLED`, `RELAYER_CARDANO_LOCK_ADDRESS`) ingesting UTxOs into `source.cardano` with matching finality waits (Yaci-only for Cardano when `RELAYER_YACI_URL` or `YACI_URL` is set). Local Yaci + funded wallet: [docs/CARDANO_LOCAL_YACI.md](../docs/CARDANO_LOCAL_YACI.md) and `scripts/relayer-cardano-srs.env.sh`.
- Midnight indexer ping for health.

## Run

```bash
cd zk-stables-relayer
npm install
npm start
```

Default URL: `http://127.0.0.1:8787` (`RELAYER_PORT`).

### Demo wallets API (UI)

When `RELAYER_ENABLE_DEMO_WALLETS=true`, the relayer exposes **`GET /v1/demo/wallets`** with deterministic **EVM** accounts derived from `RELAYER_DEMO_MNEMONIC_EVM` (default: Hardhat/Anvil test phrase), optional **Cardano** bech32 addresses from env, and **Midnight** example addresses for copy/paste. **Mnemonics and private keys are only included when `NODE_ENV` is not `production`.** See `.env.example` for `RELAYER_DEMO_*` variables.

Job responses from **`POST /v1/intents/*`** and **`GET /v1/jobs`** now include a **`ui`** object: `phaseLabel`, `phaseIndex`, `phaseCount` for progress UIs.

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
| `RELAYER_SRS_STRICT` | _(false)_ | If `true`, **exit on startup** unless **all** SRS-required env vars are set (EVM lock/burn/pool/mint keys, Cardano indexer + watcher + bridge + wallet, Midnight wallet + contract, demo wallets + three `RELAYER_BRIDGE_*` recipients). See [docs/SRS_RELAYER_REQUIREMENTS.md](../docs/SRS_RELAYER_REQUIREMENTS.md). |
| `RELAYER_REQUIRE_MIDNIGHT_AND_CARDANO` | _(false)_ | Legacy: if `true` and `RELAYER_SRS_STRICT` is not `true`, only Midnight + Cardano checks run |
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
| `RELAYER_EVM_CONFIRMATIONS` | `1` | Blocks after mined log before proving (finality). Use **`0` on quiet Anvil** so the block containing `Locked` is included when `tip - confirmations` scans (or mine extra blocks / see `docs/LOCAL_BRIDGE_INTEGRATION_REPORT.md`). |
| `RELAYER_EVM_LOCK_DEST_CHAIN` | `midnight` | Destination label on watcher-enqueued LOCK intents (`evm` for same-chain tests) |
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
| `RELAYER_EVM_WRAPPED_TOKEN_USDC` / `RELAYER_EVM_WRAPPED_TOKEN_USDT` | _(unset)_ | Optional second watcher address when both zk tokens are deployed |
| `RELAYER_EVM_BURN_ASSET` | `USDC` | `USDC` or `USDT` — sets `asset` / `assetKind` on watcher-enqueued burn jobs when using **only** `RELAYER_EVM_WRAPPED_TOKEN` |
| `RELAYER_CARDANO_OPERATOR_BURN_RELEASE` | _(false)_ | If `true`, relayer may submit operator `BridgeRelease` for Cardano-sourced BURN |
| `RELAYER_CARDANO_DESTINATION_LOCK_HOLD` | _(false)_ | If `true`, LOCK→Cardano stops after mint+lock (recipient-only datum for user `BridgeRelease`) |
| `RELAYER_EVM_POOL_LOCK` | _(unset)_ | Pool to call `unlockWithInclusionProof` after burn proof |
| `RELAYER_EVM_UNDERLYING_TOKEN` | _(unset)_ | Underlying ERC-20 released on unlock (e.g. mUSDC) |
| `RELAYER_EVM_TOKEN_DECIMALS` | `6` | Parse `intent.amount` for mint/unlock (stablecoin-style) |
| `RELAYER_EVM_BRIDGE_MINT` / `RELAYER_EVM_PRIVATE_KEY` | _(unset)_ | Optional auto-mint after LOCK |
| `RELAYER_CARDANO_BRIDGE_ENABLED` | _(false)_ | Set `true` to submit Cardano payout txs from the relayer wallet |
| `RELAYER_CARDANO_WALLET_MNEMONIC` | _(unset)_ | 24-word mnemonic for Mesh `MeshWallet` (fund on your network) |
| `RELAYER_CARDANO_NETWORK_ID` | `0` | `0` = testnet addresses, `1` = mainnet |
| `RELAYER_CARDANO_MESH_NETWORK` | `preprod` | Mesh network id (`preprod`, `preview`, `mainnet`, …) |
| `RELAYER_CARDANO_PLUTUS_JSON` | _(auto)_ | Absolute path to `cardano/aiken/plutus.json` (from `aiken build`). Default: `zk-stables-relayer/../../../../cardano/aiken/plutus.json` relative to package |
| `RELAYER_CARDANO_PAYOUT_LOVELACE` | `3000000` | Lovelace in the locked UTxO (min-ADA; floored by `RELAYER_CARDANO_MINT_OUTPUT_LOVELACE`) |
| `RELAYER_CARDANO_ASSET_DECIMALS` | `6` | Decimals when interpreting `intent.amount` |
| `RELAYER_CARDANO_MINT_TOKEN_NAME` | _(unset)_ | Override ASCII token name for WUSDC/WUSDT mint (default from `intent.asset`) |
| `RELAYER_CARDANO_MINT_OUTPUT_LOVELACE` | `2000000` | Min lovelace in the lock output carrying minted assets |
| `RELAYER_CARDANO_LOCK_UTXO_WAIT_MS` | `90000` | After lock tx submit, poll Yaci Store / indexer until the script UTxO appears (avoids immediate “Could not find lock UTxO” on indexer lag) |
| `RELAYER_CARDANO_LOCK_UTXO_POLL_MS` | `500` | Delay between polls while waiting for the lock UTxO at the script address |
| `RELAYER_CARDANO_RECIPIENT_COMMITMENT_HEX` | _(derived)_ | Optional 64-hex `recipient_commitment` in `LockDatum`; default SHA-256 of `lockRef:proofDigest` |
| `RELAYER_CARDANO_LOCK_SOURCE_CHAIN_ID` / `RELAYER_CARDANO_LOCK_DEST_CHAIN_ID` | `0` | `source_chain_id` / `destination_chain_id` in `LockDatum` |
| `RELAYER_CARDANO_LOCK_NONCE` | `0` | `lock_nonce` in `LockDatum` |
| `RELAYER_CARDANO_RELEASE_PAYOUT_ADDRESS` | _(unset)_ | Bech32 payout when BURN recipient is not Cardano (with `RELAYER_BRIDGE_CARDANO_RECIPIENT`) |
| `RELAYER_MIDNIGHT_ENABLED` | _(false)_ | Run Midnight mint pipeline after LOCK → midnight |
| `GENESIS_SEED_HASH_HEX` | _(unset)_ | **Preferred:** 64 hex chars = 32-byte HD seed (same as zk-stables-ui + `local-cli` `run-genesis-all`). Deploy/join keys default from `zkstables:depositCommitment:v1` / `operatorSk` / `holderSk` unless `DEPOSIT_COMMITMENT_HEX` / `OPERATOR_SK_HEX` / `HOLDER_SK_HEX` are set. |
| `BIP39_MNEMONIC` | _(unset)_ | Midnight relayer wallet when **`GENESIS_SEED_HASH_HEX` is not set** |
| `RELAYER_MIDNIGHT_CONTRACT_ADDRESS` / `RELAYER_MIDNIGHT_AUTO_DEPLOY` | _(unset)_ | Midnight contract join vs deploy |
| `RELAYER_BRIDGE_EVM_RECIPIENT` | _(unset)_ | `0x` address — relayer bridge EVM wallet; default `recipient` for some POST flows; echoed in `connected.relayerBridge` |
| `RELAYER_BRIDGE_CARDANO_RECIPIENT` | _(unset)_ | Bech32 or hex payment cred — relayer bridge Cardano wallet; same semantics as EVM var for Cardano-sourced BURN and midnight flows |
| `RELAYER_BRIDGE_MIDNIGHT_RECIPIENT` | _(unset)_ | Midnight bech32 destination for Cardano lock watcher when `RELAYER_CARDANO_RECIPIENT_STUB` is empty |

Copy `.env.example` to `.env` and set your project id locally — **do not commit** API keys.

## API

- `GET /health` — liveness
- `GET /v1/health/chains` — optional EVM + Midnight indexer checks (+ `relayerBridge` configured flags)
- `GET /v1/bridge/recipients` — configured `RELAYER_BRIDGE_*` addresses (dev convenience; protect in production)
- `GET /v1/cardano/bridge-metadata` — lock pool script CBOR + address for Mesh in the browser
- `POST /v1/intents/lock` — enqueue lock intent (body: `LockIntent`)
- `POST /v1/intents/burn` — enqueue burn intent (body: `BurnIntent`)
- `GET /v1/jobs` — list jobs (memory; dev only)
- `GET /v1/jobs/:id` — job status + `proofBundle` when ready

## Web UI

Set `VITE_RELAYER_URL=http://127.0.0.1:8787` in `zk-stables-ui` and use **Submit to relayer** on the cross-chain intent card. For Cardano redeem in the browser, also set `VITE_YACI_URL` or `VITE_BLOCKFROST_PROJECT_ID` (same indexer as the relayer).
