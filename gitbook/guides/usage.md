# Usage Guide

Full walkthrough of building, running, and operating all ZK-Stables bridge components.

**Prerequisites:** Node.js **20+** everywhere npm is used. For Midnight paths, Docker and a local stack are required.

Cross-chain intent flow (USDC/USDT on source rails to validated mint as zkUSDC/zkUSDT on destination): see [BRIDGE_SWAP_FLOW.md](https://github.com/dextrlabs-dev/ZK-Stables-USDC-USDT-Non-Custodial-Bridge/blob/main/docs/BRIDGE_SWAP_FLOW.md).

## Repository layout

| Path | Role |
|------|------|
| `contract/` | Midnight Compact sources, managed outputs, TypeScript build |
| `local-cli/` | Deploy and run contracts on local Midnight (`undeployed` network id) |
| `zk-stables-ui/` | Vite + React dApp (Lace, circuits, deploy/join flows) |
| `zk-stables-relayer/` | Relayer HTTP service |
| `evm/` | Hardhat + Solidity |
| `cardano/aiken/` | On-chain validators |
| `cardano/ts/` | Off-chain TypeScript CLIs (Mesh) |
| `sdk/` | TypeScript SDK for relayer API |
| `bridge-cli/` | Operator CLI (`zk-bridge`) |
| `bridge-operator-console/` | Vite + React operator UI |

## Midnight contract (Compact + TypeScript)

```bash
cd contract
npm install
npm run compact   # requires Compact CLI
npm run build
npm run typecheck
```

Encoding and ledger notes: [DEPOSIT_COMMITMENT_ENCODING.md](https://github.com/dextrlabs-dev/ZK-Stables-USDC-USDT-Non-Custodial-Bridge/blob/main/contract/docs/DEPOSIT_COMMITMENT_ENCODING.md), [LEDGER_ADT_EXTENSION.md](https://github.com/dextrlabs-dev/ZK-Stables-USDC-USDT-Non-Custodial-Bridge/blob/main/contract/docs/LEDGER_ADT_EXTENSION.md).

## One-command local UI + relayer + EVM

With Midnight Docker (node :9944, indexer :8088) and a proof-server on :6301 running:

```bash
./scripts/start-yaci-devkit.sh   # Cardano: start Yaci first
./scripts/start-local-stack.sh   # deploys EVM, funds, relayer, Vite
```

This starts a Hardhat node on :8545, deploys EVM contracts, patches `zk-stables-ui/.env.development` with token addresses, restarts the relayer on :8787, runs `npm run fund:local` (Yaci ADA top-up + EVM zk mint seed), and runs Vite on :5173.

After code changes (without redeploying contracts):

```bash
./scripts/restart-local-dev-services.sh
```

| Service | URL |
|---------|-----|
| UI | http://127.0.0.1:5173 |
| Relayer | http://127.0.0.1:8787/health |
| Deploy JSON | `/tmp/zk-stables-anvil-addrs.json` |

Set `ZK_STABLES_SKIP_FUND=1` to skip funding if Yaci is not ready. Set `ZK_STABLES_RESTART_RELAYER=0` to keep the existing relayer process.

## Second proof-server (alternate port)

If port 6300 is already in use:

```bash
./scripts/start-alt-proof-server.sh 6301
```

Then set `MIDNIGHT_PROOF_SERVER=http://127.0.0.1:6301` (local-cli) and `RELAYER_MIDNIGHT_PROOF_SERVER=http://127.0.0.1:6301` (relayer). For the UI, set `VITE_MIDNIGHT_PROOF_SERVER_PORT=6301`.

## Local CLI (Midnight undeployed)

Requires a running [midnight-local-network](https://github.com/bricktowers/midnight-local-network) stack and a funded mnemonic. See the [Midnight local CLI guide](midnight-local-cli.md).

```bash
npm install
cd local-cli
export BIP39_MNEMONIC="your twelve or more words"
npm run deploy
```

## Web UI

After the contract is compiled and built:

```bash
cd zk-stables-ui
npm install
npm run dev
```

See [zk-stables-ui/README.md](https://github.com/dextrlabs-dev/ZK-Stables-USDC-USDT-Non-Custodial-Bridge/blob/main/zk-stables-ui/README.md).

### Redeem flows

- **EVM**: underlying USDC/USDT is claimed on EVM via pool unlock.
- **Cardano**: generate a 32-byte redeem commitment, lock zk at the `lock_pool` script (same commitment in the datum), run `BridgeRelease`, then submit the BURN intent to the relayer. See [BURN_ANCHOR_SPEC.md](https://github.com/dextrlabs-dev/ZK-Stables-USDC-USDT-Non-Custodial-Bridge/blob/main/docs/BURN_ANCHOR_SPEC.md).
- **Midnight**: run `initiateBurn` with the same commitment as `burnCommitmentHex`, then submit the BURN intent.

## Relayer

```bash
cd zk-stables-relayer
npm install
npm run typecheck   # or npm run dev / npm start
```

## EVM (Hardhat)

```bash
cd evm
npm install
npm test
npx hardhat compile
npm run deploy:anvil   # optional: deploy to local Anvil
```

## Cardano

**Aiken** (validators + embedded tests):

```bash
cd cardano/aiken
aiken check
```

**TypeScript** (Mesh CLIs):

```bash
cd cardano/ts
npm install
npm run typecheck
```

See the [Cardano validators](../components/cardano-validators.md) page.

### Cardano user redeem (BridgeRelease)

- Relayer can mint+lock without an operator in the datum when `RELAYER_CARDANO_DESTINATION_LOCK_HOLD=true`.
- Browser: set `VITE_YACI_URL` or `VITE_BLOCKFROST_PROJECT_ID` to the same indexer the relayer uses.
- Redeem payout from Cardano or Midnight is EVM-only in the UI: the recipient must be a `0x` address.

## Workspace root scripts

From the repo root `package.json`:

- `npm run contract:compact` / `npm run contract:build` -- contract workspace
- `npm run run-genesis` / `npm run run-registry-all` -- local-cli scripts

## Local verification

```bash
npm ci
npm run typecheck -w @zk-stables/midnight-contract
npm run typecheck -w @zk-stables/relayer
npm run typecheck -w bridge-operator-console
(cd evm && npm ci && CI=true npm test)
(cd cardano/aiken && aiken check)
(cd cardano/ts && npm ci && npm run typecheck)
```

CI test results: `evm/test-results/junit-evm.xml`.
