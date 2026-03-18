# Usage guide

**Prerequisites:** Node.js **20+** everywhere npm is used. For Midnight paths, Docker and a local stack are required; see package READMEs for exact versions.

Cross-chain intent flow (USDC/USDT on source rails → validated mint as **zkUSDC/zkUSDT** on destination): [BRIDGE_SWAP_FLOW.md](BRIDGE_SWAP_FLOW.md).

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

## One-command local UI + relayer + EVM

With Midnight Docker (node **9944**, indexer **8088**) and a proof-server on **6301** (run `./scripts/start-alt-proof-server.sh` when you keep another app on **6300**), and `zk-stables-relayer/.env` configured (see that file and [zk-stables-relayer/.env.integration.example](../zk-stables-relayer/.env.integration.example)):

```bash
./scripts/start-yaci-devkit.sh   # Cardano: start Yaci first so funding can run
./scripts/start-local-stack.sh   # deploys EVM, funds (npm run fund:local), relayer, Vite
```

This starts (or reuses) a **Hardhat node** on **8545**, **deploys** EVM contracts, patches **`zk-stables-ui/.env.development`** token addresses from the deploy JSON, **restarts the relayer** on `RELAYER_PORT` (default **8787**) so it picks up the new pool addresses, runs **`npm run fund:local`** (Yaci ADA top-up + EVM zk mint seed), and runs **Vite** on **5173**.

After **relayer** or **UI** code changes (without redeploying contracts), restart those two only:

```bash
./scripts/restart-local-dev-services.sh
```

- **UI:** http://127.0.0.1:5173  
- **Relayer:** http://127.0.0.1:8787/health  
- **Deploy JSON:** `/tmp/zk-stables-anvil-addrs.json`  

**Yaci** on **8080** for Cardano in the UI (`./scripts/start-yaci-devkit.sh`). **`./scripts/start-local-stack.sh`** runs **`npm run fund:local`** after the relayer starts (Cardano ADA top-ups via Yaci admin + EVM zk seed). That step **fails** if Yaci Store/admin are not up — start DevKit first, or set `ZK_STABLES_SKIP_FUND=1` and run `npm run fund:local` manually once Yaci is ready. Set `ZK_STABLES_RESTART_RELAYER=0` if you must not kill an existing process on the relayer port.

End-to-end Cardano smoke (Yaci + funded wallet + relayer LOCK/BURN → Cardano + `cardano/ts` yaci-smoke): **`npm run test:cardano-local`** (expects relayer on `RELAYER_PORT` and Yaci on **8080**).

## Second proof-server (undeployed, alternate port)

If port **6300** is already used by another Midnight app, start an additional proof-server and point ZK-Stables at it:

```bash
./scripts/start-alt-proof-server.sh 6301   # host :6301 → container :6300
```

Then set **`MIDNIGHT_PROOF_SERVER=http://127.0.0.1:6301`** (local-cli) and **`RELAYER_MIDNIGHT_PROOF_SERVER=http://127.0.0.1:6301`** (relayer). The relayer wallet now reads the same URL for `provingServerUrl`. For the Vite UI, set **`VITE_MIDNIGHT_PROOF_SERVER_PORT=6301`** in `zk-stables-ui/.env.development`.

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

**Redeem (bridge card, Redeem tab) → EVM:** Underlying USDC/USDT is claimed on EVM. **Cardano:** there is no wallet `burn` for native zk in this repo — use the in-card wizard: generate a 32-byte redeem commitment, **lock** zk at the `lock_pool` script (same commitment in the datum), **BridgeRelease**, then submit the BURN intent to the relayer ([BURN_ANCHOR_SPEC.md](BURN_ANCHOR_SPEC.md)). **Midnight:** run **`initiateBurn`** with the same commitment as `burnCommitmentHex` (from the bridge card or Developer tools → Circuits), then submit the BURN intent.

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

### Cardano user redeem (BridgeRelease)

- Relayer can mint+lock **without** an operator in the datum when `RELAYER_CARDANO_DESTINATION_LOCK_HOLD=true` (recipient-only `BridgeRelease`).
- Browser: set `VITE_YACI_URL` or `VITE_BLOCKFROST_PROJECT_ID` to the same indexer the relayer uses; the UI loads `/v1/cardano/bridge-metadata` for script CBOR.
- **Redeem payout (BURN) from Cardano or Midnight** is **EVM-only** in the UI: the recipient must be a `0x` address so underlying USDC/USDT unlocks on the configured EVM pool.
- Checklist script: [scripts/srs-e2e-cardano-redeem.sh](../scripts/srs-e2e-cardano-redeem.sh). Anchor spec: [docs/BURN_ANCHOR_SPEC.md](BURN_ANCHOR_SPEC.md).

### Cardano in-wallet lock (zk → script) + relayer watcher

- **Bridge card (Mint)** with **source = Cardano** uses **destination EVM only**: sign **Lock zk in Cardano wallet** to send native zkUSDC/zkUSDT to the `lock_pool` script with an **inline** `LockDatum` (so the relayer can read `lockNonce` for stub proofs). Set `VITE_CARDANO_WUSDC_UNIT` / `VITE_CARDANO_WUSDT_UNIT` and optional `VITE_ZK_SOURCE_CHAIN_ID` / `VITE_ZK_DEST_CHAIN_ID` (align with `RELAYER_ZK_SOURCE_CHAIN_ID` / `RELAYER_ZK_DEST_CHAIN_ID`). Optional `VITE_CARDANO_LOCK_RECIPIENT_COMMITMENT_HEX` (64 hex); default is 64×`0`.
- **Relayer watcher**: set `RELAYER_CARDANO_WATCHER_ENABLED=true` and `RELAYER_CARDANO_LOCK_ADDRESS` to the **same** script address as `GET /v1/cardano/bridge-metadata` → `lockScriptAddress`. Use `RELAYER_CARDANO_DEST_CHAIN=evm` for the Cardano→EVM mint path. The watcher reads **inline datum** when present and sets `source.cardano.lockNonce` on enqueued LOCK intents.
- Without inline datum (hash-only locks), `lockNonce` defaults to `0` in the stub proof path and may not match the on-chain datum — prefer the in-app lock flow for local demos.

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
