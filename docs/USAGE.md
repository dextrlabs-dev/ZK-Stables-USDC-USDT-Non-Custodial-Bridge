# Usage guide

**Prerequisites:** Node.js **20+** everywhere npm is used. For Midnight paths, Docker and a local stack are required; see package READMEs for exact versions.

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

## Midnight contract (Compact + TypeScript)

From the repository root:

```bash
cd contract
npm install
npm run compact   # needs Compact CLI installed
npm run build
npm run typecheck
```

Encoding and ledger notes: [contract/docs/DEPOSIT_COMMITMENT_ENCODING.md](../contract/docs/DEPOSIT_COMMITMENT_ENCODING.md), [contract/docs/LEDGER_ADT_EXTENSION.md](../contract/docs/LEDGER_ADT_EXTENSION.md).

## Local CLI (Midnight undeployed)

Requires a running [midnight-local-network](https://github.com/bricktowers/midnight-local-network)-style stack and a funded mnemonic. Full environment table and flow: [local-cli/README.md](../local-cli/README.md).

```bash
# from repo root (workspaces)
npm install
cd local-cli
export BIP39_MNEMONIC="your twelve or more words"
npm run deploy
```

## Web UI

After `contract` is compiled and built:

```bash
cd zk-stables-ui
npm install
npm run dev
```

Details: [zk-stables-ui/README.md](../zk-stables-ui/README.md).

## Relayer

```bash
cd zk-stables-relayer
npm install
npm run typecheck   # or npm run dev / start per package.json
```

## EVM (Hardhat)

```bash
cd evm
npm install
npm test
npx hardhat compile
```

Optional: `npm run deploy:anvil` with a local JSON-RPC endpoint (see `hardhat.config.ts`).

## Cardano

**Aiken** (validators + unit tests embedded in `aiken check`):

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

See [cardano/README.md](../cardano/README.md) for blueprint and script context.

## Workspace root scripts

From the repo root `package.json`:

- `npm run contract:compact` / `npm run contract:build` — contract workspace
- `npm run run-genesis` / `npm run run-registry-all` — local-cli scripts (after env + network are ready)

## CI parity (local)

To approximate what GitHub Actions runs:

```bash
npm ci
npm run typecheck -w @zk-stables/midnight-contract
npm run typecheck -w @zk-stables/relayer
npm run typecheck -w @zk-stables/ui
(cd evm && npm ci && CI=true npm test)
(cd cardano/aiken && aiken check)
(cd cardano/ts && npm ci && npm run typecheck)
```

Report locations when `CI=true` in `evm`: `evm/test-results/junit-evm.xml`.
