# zk-stables local CLI (undeployed)

Deploys the `zk-stables` Compact contract to a [Brick Towers local Midnight stack](https://github.com/bricktowers/midnight-local-network) using `networkId: 'undeployed'`.

## Prerequisites

- **Node.js ≥ 20** (Wallet SDK runtime uses APIs such as `Array.prototype.toSpliced` on some paths.)
- Docker stack running from `midnight-local-network` (`compose.yml`: node `0.22.1`, indexer `4.0.0`, proof-server `8.0.3`).
- Contract artifacts: from repo root, `cd contract && npm run compact && npm run build`.

## Environment

| Variable | Required | Description |
|----------|----------|-------------|
| `BIP39_MNEMONIC` | Yes | Valid BIP-39 phrase for the wallet that will pay fees and deploy. |
| `MIDNIGHT_LDB_PASSWORD` | No | ≥16 characters and ≥3 character classes (upper, lower, digit, symbol). Default in `providers.ts` satisfies that (not for production). |
| `OPERATOR_SK_HEX` / `HOLDER_SK_HEX` | No | 64 hex chars (32 bytes) each; default `01…` / `02…` in dev. |
| `DEPOSIT_COMMITMENT_HEX` | No | 64 hex chars; default `00…`. |
| `INDEXER_PORT` / `NODE_PORT` / `PROOF_SERVER_PORT` | No | Override endpoints in `wallet.ts` (default `8088`, `9944`, `6300`). |

## Flow

1. Start the network: `docker compose -f compose.yml up -d` in `midnight-local-network`.
2. Fund the same mnemonic the CLI will use (Node 20+). For deploy you need **dust** for fees; use:  
   `npx tsx src/fund-and-register-dust.ts "<mnemonic>"`  
   (or `yarn fund-and-register-dust` if you use Yarn). Plain `fund` alone is often not enough.
3. **Single `node_modules` for `contract` + `local-cli`:** symlink `contract/node_modules` → `../local-cli/node_modules` (or use npm workspaces) so `@midnight-ntwrk/compact-js` / WASM types are not duplicated; otherwise deploy can fail with missing `ctor` or `ContractMaintenanceAuthority` class errors.
4. Deploy:

```bash
cd local-cli
npm install
export BIP39_MNEMONIC="your words here"
npm run deploy
```

## Patches (`patch-package`)

The repo ships patches under `local-cli/patches/` for `@midnight-ntwrk/wallet-sdk-*` so **native `Map` iterators** from `ledger-v8` work with SDK code that assumed Effect-style collections (`.values().map`, `.entries().filter`, etc.). `npm install` in `local-cli` runs `patch-package` automatically.

## Files

- `src/deploy-local.ts` — sync wallet, `deployContract`, print ledger from **`deployTxData.public.initialContractState`** (avoids hanging on indexer `queryContractState` / snapshot lag).
- `src/zk-stables-compiled-contract.ts` — `CompiledContract` built with local-cli’s `compact-js` (same instance as midnight-js).
- `src/providers.ts` — indexer + proof + `NodeZkConfigProvider` + `levelPrivateStateProvider` (account-scoped LevelDB).
- `src/wallet.ts` — `WalletFacade` + `ledger-v8`, mirrors local-network `utils.ts` URLs (`127.0.0.1`).
- `src/holder-key.ts` — off-chain `holderLedgerPublicKey` (same domain as on-chain holder PK derivation).
- `src/config.ts` — `setNetworkId('undeployed')` and path to `contract/src/managed/zk-stables` ZK artifacts.

## Web UI (Lace)

The [zk-stables-ui](../zk-stables-ui/) package is a browser dApp (example-zkloan-style) for deploy/join and all bridge circuits. After `cd contract && npm run compact && npm run build`, run `cd ../zk-stables-ui && npm install && npm run dev`, open the Vite URL, connect Lace on `undeployed`, and use the forms (see [zk-stables-ui/README.md](../zk-stables-ui/README.md)).
