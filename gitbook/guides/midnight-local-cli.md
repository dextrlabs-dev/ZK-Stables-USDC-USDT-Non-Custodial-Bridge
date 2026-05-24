# Midnight Local CLI (Undeployed)

Guide for deploying and running the `zk-stables` Compact contract on a local Midnight stack using the `local-cli` package. Source code lives in [`local-cli/`](https://github.com/dextrlabs-dev/ZK-Stables-USDC-USDT-Non-Custodial-Bridge/tree/main/local-cli).

## Prerequisites

- **Node.js >= 20** (Wallet SDK runtime uses APIs such as `Array.prototype.toSpliced`)
- **Docker** stack running from [midnight-local-network](https://github.com/bricktowers/midnight-local-network) (`compose.yml`: node 0.22.1, indexer 4.0.0, proof-server 8.0.3)
- **Contract artifacts**: from the repo root, build the contract first:

```bash
cd contract
npm run compact   # requires Compact CLI
npm run build
```

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `BIP39_MNEMONIC` | Yes | Valid BIP-39 phrase for the wallet that pays fees and deploys |
| `MIDNIGHT_LDB_PASSWORD` | No | >=16 characters with >=3 character classes. A default is provided for development. |
| `OPERATOR_SK_HEX` / `HOLDER_SK_HEX` | No | 64 hex chars (32 bytes) each; default `01...` / `02...` in dev |
| `DEPOSIT_COMMITMENT_HEX` | No | 64 hex chars; default `00...` |
| `INDEXER_PORT` / `NODE_PORT` / `PROOF_SERVER_PORT` | No | Override endpoints (default 8088, 9944, 6300) |
| `MIDNIGHT_PROOF_SERVER` | No | Full proof-server URL (e.g. `http://127.0.0.1:6301`) if you run a second server |

## Deploy flow

### 1. Start the Midnight network

```bash
# In the midnight-local-network directory
docker compose -f compose.yml up -d
```

### 2. Fund the wallet

The deploy wallet needs dust for fees:

```bash
cd local-cli
npx tsx src/fund-and-register-dust.ts "<mnemonic>"
```

Plain `fund` alone is often not enough -- use `fund-and-register-dust`.

### 3. Shared `node_modules`

Symlink `contract/node_modules` to `../local-cli/node_modules` (or use npm workspaces) so `@midnight-ntwrk/compact-js` / WASM types are not duplicated. Otherwise deploy can fail with missing `ctor` or `ContractMaintenanceAuthority` class errors.

### 4. Deploy

```bash
cd local-cli
npm install
export BIP39_MNEMONIC="your words here"
npm run deploy
```

The deploy script uses `networkId: 'undeployed'` and prints the ledger state from `deployTxData.public.initialContractState` (avoids hanging on indexer `queryContractState` / snapshot lag).

## Key files

| File | Purpose |
|------|---------|
| `src/deploy-local.ts` | Sync wallet, `deployContract`, print initial ledger |
| `src/zk-stables-compiled-contract.ts` | `CompiledContract` built with local-cli's `compact-js` |
| `src/providers.ts` | Indexer, proof server, `NodeZkConfigProvider`, `levelPrivateStateProvider` |
| `src/wallet.ts` | `WalletFacade` + `ledger-v8`, local-network URLs (127.0.0.1) |
| `src/holder-key.ts` | Off-chain `holderLedgerPublicKey` derivation |
| `src/config.ts` | `setNetworkId('undeployed')` and path to ZK artifacts |

## Patches

The repo ships patches under `local-cli/patches/` for `@midnight-ntwrk/wallet-sdk-*` so native `Map` iterators from `ledger-v8` work with SDK code that assumed Effect-style collections. `npm install` runs `patch-package` automatically.

## Second proof-server

If port 6300 is in use by another Midnight app:

```bash
./scripts/start-alt-proof-server.sh 6301
```

Then set `MIDNIGHT_PROOF_SERVER=http://127.0.0.1:6301` before running local-cli commands.

## Web UI (Lace)

After deploying via local-cli, you can use the browser dApp:

```bash
cd zk-stables-ui
npm install
npm run dev
```

Open the Vite URL, connect Lace on `undeployed`, and use the deploy/join forms and bridge circuits. See [zk-stables-ui/README.md](https://github.com/dextrlabs-dev/ZK-Stables-USDC-USDT-Non-Custodial-Bridge/blob/main/zk-stables-ui/README.md).
