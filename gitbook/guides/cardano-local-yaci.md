# Cardano Local Stack (Yaci)

Guide for setting up a local Cardano devnet with Yaci DevKit and connecting it to the ZK-Stables relayer.

## Requirements

To capture Cardano transaction hashes in relayer jobs (`destinationHint` lines like `Cardano payout tx: ...`), you need:

1. An indexer (Yaci Store or Blockfrost)
2. `RELAYER_CARDANO_WATCHER_ENABLED=true` and `RELAYER_CARDANO_BRIDGE_ENABLED=true`
3. A funded `RELAYER_CARDANO_WALLET_MNEMONIC` for Mesh payouts
4. `RELAYER_CARDANO_LOCK_ADDRESS` -- bech32 address the lock watcher polls

## Option A -- Yaci DevKit (recommended)

### 1. Install DevKit

```bash
curl --proto '=https' --tlsv1.2 -LsSf https://devkit.yaci.xyz/install.sh | bash
```

See the [Docker setup guide](https://devkit.yaci.xyz/getting-started/docker).

### 2. Resolve port conflicts

DevKit's Yaci Viewer defaults to port **5173**, which conflicts with the ZK-Stables Vite app. Before starting, set a different viewer port in `~/.yaci-devkit/config/env`:

```
HOST_VIEWER_PORT=5280
```

Yaci Store stays on **8080** unless you change `HOST_STORE_API_PORT`.

### 3. Start containers

From the repo root:

```bash
./scripts/start-yaci-devkit.sh
```

Or interactively: `devkit start`, then `create-node -o --start`.

### 4. Fund addresses

From the Yaci CLI:

```
devnet:default> topup <addr_test1...> 10000
```

Or from the repo (after DevKit admin is up on port 10000):

```bash
npm run fund:cardano-yaci
```

This tops up every `addr_test1` in `zk-stables-relayer/.env` plus the Mesh change address from `RELAYER_CARDANO_WALLET_MNEMONIC` (default 50000 ADA each; override with `RELAYER_CARDANO_TOPUP_ADA`).

### 5. Configure the relayer

Point the relayer at Yaci Store:

```bash
RELAYER_YACI_URL=http://127.0.0.1:8080/api/v1
RELAYER_YACI_ADMIN_URL=http://127.0.0.1:10000
```

### 6. Set the lock address

Obtain a lock script payment address:

- Run the Plutus lock flow under `cardano/ts` (e.g. `yaci-smoke` / lock scripts) and use the script address
- Or use any funded address for demo polling

### 7. Enable everything

```bash
cd /path/to/ZK-Stables-USDC-USDT-Non-Custodial-Bridge
export RELAYER_CARDANO_LOCK_ADDRESS=addr_test1...
export RELAYER_CARDANO_WALLET_MNEMONIC="word1 word2 ... word24"
set -a
source scripts/relayer-cardano-srs.env.sh
set +a
```

## Option B -- Blockfrost (Preprod / Mainnet)

Unset `RELAYER_YACI_URL` and set:

```bash
RELAYER_BLOCKFROST_PROJECT_ID=<project_id>
RELAYER_BLOCKFROST_NETWORK=preprod   # or mainnet
```

Keep `RELAYER_CARDANO_WATCHER_ENABLED=true` and `RELAYER_CARDANO_BRIDGE_ENABLED=true`, and set the same lock address + mnemonic (funded on that network).

## Getting a Cardano tx hash in reports

| Scenario | How |
|----------|-----|
| LOCK to Cardano (EVM watcher) | Set `RELAYER_EVM_LOCK_DEST_CHAIN=cardano`; `Locked` event recipient must be a valid bech32 address |
| LOCK from Cardano (Cardano watcher) | Deposit at `RELAYER_CARDANO_LOCK_ADDRESS`; watcher enqueues `sourceChain: cardano` jobs |
| BURN to Cardano | Intent `recipient` as `addr1...` / `addr_test1...` with bridge enabled |

After job completion, read `GET /v1/jobs/:id` and inspect `destinationHint`.

## Troubleshooting

### UI shows `Yaci Store UTxOs: HTTP 500` (or 502/503)

The Vite dev app proxies to `http://127.0.0.1:8080`. If Yaci Store is not running, the proxy returns 5xx.

**Fix:** Run `./scripts/start-yaci-devkit.sh` and verify:

```bash
curl -sS http://127.0.0.1:8080/api/v1/blocks/latest
```

To point the UI at a remote Store, set `VITE_YACI_STORE_URL` to the full base URL (CORS must allow the browser origin).

### Conway submit: `NotAllowedSupplementalDatums`

The tx is attaching a witness datum while the spent UTxO has an inline datum. The relayer and `cardano/ts` release/refund paths use Mesh `txInInlineDatumPresent()` for spends of `lock_pool` outputs created with `txOutInlineDatumValue`. Upgrade the repo if you see this on an older checkout.
