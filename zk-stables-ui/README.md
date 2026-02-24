# ZK-Stables web UI

Vite + React + MUI dApp modeled on [example-zkloan](https://github.com/midnightntwrk/example-zkloan) (`zkloan-credit-scorer-ui`): Midnight Lace via `@midnight-ntwrk/dapp-connector-api`, `FetchZkConfigProvider` + static ZK keys under `public/`, `deployContract` / `findDeployedContract`, and all `zk-stables` circuits.

The repo PDFs (SRS + architecture blueprint) describe **EVM and Cardano** lock/mint/relayer/ZK flows. This UI adds **wagmi** (injected EVM wallet + chain switch) and **CIP-30** Cardano wallet connect, plus an **SRS-style lock intent** form (asset, amount, source/destination, recipient). It does **not** deploy Ethereum pool contracts, Plutus validators, or relayers; those are integration points for future work. Optional env: `VITE_ETH_SEPOLIA_RPC_URL`, `VITE_ETH_MAINNET_RPC_URL`, `VITE_ETH_LOCALHOST_RPC_URL`, `VITE_EVM_LOCK_CONTRACT` (placeholder for a future lock contract address).

Stack matches `local-cli`: **ledger-v8**, **midnight-js 4.0.2**, **compact-js 2.5.0** / **compact-runtime 0.15.0**. The main bridge shell uses **Tailwind CSS** (utilities only; preflight off) plus **MUI** for developer panels and dialogs.

## Prerequisites

- Node.js ≥ 20.
- **Contract built** so `../contract/dist/managed/zk-stables` exists:  
  `cd ../contract && npm run compact && npm run build`
- Local Midnight stack (e.g. [midnight-local-network](https://github.com/bricktowers/midnight-local-network)) and wallet funded with dust (same as local-cli README).
- **Midnight Lace** (or compatible) extension configured for the same network as `VITE_NETWORK_ID` (default `undeployed`).

## Scripts

| Command | Description |
|--------|-------------|
| `npm install` | Install dependencies. |
| `npm run copy-zk-artifacts` | Copy `contract/src/managed/zk-stables/keys` and `zkir` → `public/` (runs automatically before `dev` / `build`). |
| `npm run dev` | Dev server (copies artifacts, then Vite). |
| `npm run build` | Typecheck + production build to `dist/`. |

## Slow or “stuck” loading in dev

The Midnight stack pulls in **large WASM** and a **big generated contract** (`index.js`). The first time you open the app, Vite must **compile a separate chunk** (`bootstrap.tsx`); that can take **tens of seconds** and the tab shows “Loading ZK-Stables…” until it finishes. This is normal.

The entry is split on purpose: `main.tsx` stays tiny so the dev server starts quickly and does not pre-warm the whole graph. If the UI never appears, check the browser **console** and the terminal running `npm run dev` for errors (missing `contract/dist`, bad sourcemaps, etc.).

## Configuration

- `.env.development` sets `VITE_NETWORK_ID=undeployed` and `VITE_LOGGING_LEVEL`.
- The wallet’s reported indexer and proof-server URLs are used at runtime (same pattern as example-zkloan).

### Foundry Anvil (local EVM testnet)

Use **Anvil** at `http://127.0.0.1:8545` (chain id **31337**) so the **Ethereum** card’s **Localhost** network and the relayer’s EVM health check line up. From repo root: `./scripts/anvil-docker.sh` — see [`../scripts/README-local-evm.md`](../scripts/README-local-evm.md).

### zk-stables-relayer (lock → proof → handoff)

Run the reference relayer next to the UI so **Submit to relayer** on the cross-chain intent card works:

```bash
cd ../zk-stables-relayer && npm install && npm start
```

Default `http://127.0.0.1:8787`. Set `VITE_RELAYER_URL` if the relayer runs elsewhere. The service implements the architecture **pipeline** (simulated finality → stub ZK digest → destination hint); it does not deploy EVM/Cardano pool contracts or submit Midnight txs. See `../zk-stables-relayer/README.md`.

### Bridge UI + server demo wallets

The main screen is a **compact bridge card** (mint/burn flows, 3×3 chains, USDC/USDT). It loads **`GET /v1/demo/wallets`** when the relayer has **`RELAYER_ENABLE_DEMO_WALLETS=true`**, showing server-derived mnemonics/keys (dev only). If that endpoint is disabled, the UI falls back to built-in **public** Anvil addresses and static Cardano/Midnight placeholders from `src/lib/bridgeDemoFallback.ts`.

### Test wallet demo (all chains)

In **development** (or when `VITE_ENABLE_DEMO_WALLETS=true`), the **Test wallet demo** card at the top wires:

- **EVM:** wagmi **mock** connector with public Hardhat/Anvil accounts (`0xf39F…`, …). Use **Load EVM mock + Cardano demo** or **Demo (mock Anvil)** on the EVM card. Optional **Switch EVM to Localhost 8545** if you run Anvil.
- **Cardano:** synthetic CIP-30-style row (no browser extension). Use a real CIP-30 wallet from the Cardano card when you need signing.
- **Midnight:** still **Lace** only; the table shows an example `mn_addr_undeployed…` for copy/paste / `yarn fund` until you connect.

Set `VITE_ENABLE_DEMO_WALLETS=false` in `.env.development` to hide the panel and mock connector.

### “Network mismatch” with Lace

The UI passes `VITE_NETWORK_ID` into `wallet.connect(...)`. If Lace is on another network (e.g. testnet while the app says `undeployed`), connection fails. Either **switch Lace** to the same network id or **change `VITE_NETWORK_ID`** to match Lace, then **restart** `npm run dev` (Vite reads env at startup).

## Security warning

This demo stores **operator and holder secret keys** in the page (like the zkloan UI stores loan secrets). Do not use real keys or production funds.

## Contract imports

The UI resolves the compiled contract and witnesses from `../contract/dist` via Vite aliases (`@contract/…`) so the browser bundle does not pull `midnight-deploy.ts` (`node:path`). Constants `zkStablesPrivateStateId` and `AssetKind` are duplicated in `src/constants/zk-stables.ts` and must stay aligned with the contract package.
