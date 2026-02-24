# Cardano local stack (Yaci) + relayer

To capture **Cardano transaction hashes** in relayer jobs (`destinationHint` lines like `Cardano payout tx: …`), you need:

1. An indexer (**Yaci Store** or **Blockfrost**).
2. **`RELAYER_CARDANO_WATCHER_ENABLED=true`** and **`RELAYER_CARDANO_BRIDGE_ENABLED=true`** (SRS).
3. A funded **`RELAYER_CARDANO_WALLET_MNEMONIC`** used for Mesh payouts.
4. **`RELAYER_CARDANO_LOCK_ADDRESS`** — bech32 address the lock watcher polls for UTxOs.

## Option A — Yaci DevKit (recommended local)

1. Install and start DevKit ([Docker setup](https://devkit.yaci.xyz/getting-started/docker)):

   ```bash
   curl --proto '=https' --tlsv1.2 -LsSf https://devkit.yaci.xyz/install.sh | bash
   devkit start
   ```

2. In the Yaci CLI, create a devnet and fund test addresses:

   ```text
   yaci-cli:>create-node -o --start
   devnet:default> topup <addr_test1...> 10000
   ```

3. Point the relayer at Yaci Store (defaults match `cardano/ts/.env.example`):

   - `RELAYER_YACI_URL=http://127.0.0.1:8080/api/v1`
   - `RELAYER_YACI_ADMIN_URL=http://127.0.0.1:10000` (admin API for Mesh `YaciProvider` when needed)

4. Obtain a **lock script payment address** (UTxOs at this address are ingested by `cardanoLockWatcher`):

   - Run the Plutus lock flow under `cardano/ts` (e.g. `yaci-smoke` / lock scripts) and use the script address as `RELAYER_CARDANO_LOCK_ADDRESS`, **or**
   - Use any funded address you treat as the lock vault for demo polling (team-specific).

5. Fund the **bridge wallet** mnemonic on the same network (same `topup` or faucet).

6. Enable env in one shot:

   ```bash
   cd /path/to/ZK-Stables-USDC-USDT-Non-Custodial-Bridge
   export RELAYER_CARDANO_LOCK_ADDRESS=addr_test1...
   export RELAYER_CARDANO_WALLET_MNEMONIC="word1 word2 ... word24"
   set -a
   source scripts/relayer-cardano-srs.env.sh
   set +a
   ```

## Option B — Blockfrost (preprod / mainnet test project)

Unset `RELAYER_YACI_URL` and set:

- `RELAYER_BLOCKFROST_PROJECT_ID=<project_id>`
- `RELAYER_BLOCKFROST_NETWORK=preprod` (or `mainnet`)

Keep **`RELAYER_CARDANO_WATCHER_ENABLED=true`** and **`RELAYER_CARDANO_BRIDGE_ENABLED=true`**, and set the same lock address + mnemonic (funded on that network).

## Getting a Cardano tx hash in the report

- **LOCK to Cardano (EVM watcher)**: set `RELAYER_EVM_LOCK_DEST_CHAIN=cardano` and ensure the `Locked` event recipient is a valid **bech32** Cardano address.
- **LOCK from Cardano (Cardano watcher)**: deposit at `RELAYER_CARDANO_LOCK_ADDRESS`; watcher enqueues `sourceChain: cardano` jobs.
- **BURN to Cardano**: intent `recipient` as `addr1…` / `addr_test1…` with bridge enabled — settlement line: `Cardano unlock/payout tx: …`.

After the job completes, read `GET /v1/jobs/:id` and inspect `destinationHint`, or use the Bridge UI **Destination txs** section.
